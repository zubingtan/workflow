import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { runPiAgent, ProviderRuntimeError } from "./pi-runtime-adapter.mjs";
import { createPiBackend } from "./agent-backend.mjs";
import { mapAgentEventToSse } from "./sse-mapper.mjs";

const PORT = Number(process.env.SERVER_PORT ?? 4001);
const BINDINGS_PATH = process.env.PROVIDER_BINDINGS_FILE ?? "config/provider-bindings.json";

function loadBinding() {
  const raw = JSON.parse(readFileSync(BINDINGS_PATH, "utf8"));
  const bindings = raw?.bindings ?? {};
  const key = Object.keys(bindings)[0];
  if (!key) throw new Error(`no provider binding in ${BINDINGS_PATH}`);
  return bindings[key];
}

function resolveApiKey(binding) {
  const v = process.env[binding.apiKeyEnv];
  if (!v) throw new Error(`missing env ${binding.apiKeyEnv}`);
  return v;
}

function textOf(message) {
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) {
    return message.content.filter((p) => p?.type === "text").map((p) => p.text).join("");
  }
  return "";
}

function extractMessages(messages) {
  const systemPrompt = messages.filter((m) => m?.role === "system").map(textOf).join("\n");
  const prompt = messages.filter((m) => m?.role === "user").map(textOf).join("\n");
  return { systemPrompt, prompt };
}

const app = new Hono();

app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (c.req.method === "OPTIONS") return c.text("", 204);
  await next();
});

app.get("/health/live", (c) => c.json({ status: "live" }));

function errorSseData(err) {
  return JSON.stringify({
    error: { message: err?.message ?? "internal error", code: err?.code },
  });
}

app.post("/chat/completions", async (c) => {
  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { message: "Invalid JSON" } }, 400);
  }
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const { systemPrompt, prompt } = extractMessages(messages);
  const temperature = typeof body?.temperature === "number" ? body.temperature : undefined;

  const binding = loadBinding();
  const apiKey = resolveApiKey(binding);
  const parameters = {
    ...(binding.parameters ?? {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };

  if (body?.stream === true) {
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const id = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);
      const sseCtx = { id, model: binding.model, created };

      const backend = createPiBackend({
        systemPrompt,
        provider: binding.provider,
        baseUrl: binding.baseUrl,
        apiKey,
        model: binding.model,
        parameters,
      });

      stream.onAbort(() => backend.abort());

      const unsubscribe = backend.subscribe(async (event) => {
        const sseMessages = mapAgentEventToSse(event, sseCtx);
        for (const msg of sseMessages) {
          if (stream.aborted) return;
          await stream.writeSSE(msg);
        }
      });

      try {
        await backend.prompt(prompt);
        if (stream.aborted) return;
        const lastMessage = backend.state.messages.findLast(
          (candidate) => candidate.role === "assistant",
        );
        if (
          lastMessage &&
          (lastMessage.stopReason === "error" ||
            lastMessage.stopReason === "aborted")
        ) {
          const err = new Error(lastMessage.errorMessage ?? "provider error");
          err.code =
            lastMessage.stopReason === "aborted"
              ? "aborted"
              : "provider_error";
          await stream.writeSSE({ data: errorSseData(err) });
        }
        await stream.writeSSE({ data: "[DONE]" });
      } catch (err) {
        if (!stream.aborted) {
          await stream.writeSSE({ data: errorSseData(err) });
          await stream.writeSSE({ data: "[DONE]" });
        }
      } finally {
        unsubscribe();
        backend.dispose();
      }
    });
  }

  try {
    const result = await runPiAgent({
      prompt,
      systemPrompt,
      provider: binding.provider,
      baseUrl: binding.baseUrl,
      apiKey,
      model: binding.model,
      parameters,
    });
    return c.json({
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: binding.model,
      choices: [
        { index: 0, message: { role: "assistant", content: result }, finish_reason: "stop" },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (err) {
    const status = err instanceof ProviderRuntimeError ? 502 : 500;
    return c.json({ error: { message: err?.message ?? "internal error", code: err?.code } }, status);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`pi-hono backend listening on http://localhost:${info.port}`);
});
