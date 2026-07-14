import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.FAKE_PROVIDER_PORT ?? 4010);
const controls = new Map();
let calls = 0;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function streamCompletion(response, content = "Fake provider response") {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
    connection: "keep-alive",
  });
  response.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model: "fake-m0",
    choices: [{
      index: 0,
      delta: { role: "assistant", content },
      finish_reason: null,
    }],
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model: "fake-m0",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
  })}\n\n`);
  response.end("data: [DONE]\n\n");
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let source = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { source += chunk; });
    request.once("end", () => {
      try {
        resolve(JSON.parse(source));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.once("error", reject);
  });
}

function promptText(payload) {
  if (!Array.isArray(payload?.messages)) return "";
  return payload.messages
    .filter((message) => message?.role === "user")
    .map((message) => typeof message.content === "string" ? message.content : "")
    .join("\n");
}

function matchingControl(payload) {
  const prompt = promptText(payload);
  for (const [correlationId, control] of controls) {
    if (prompt.includes(correlationId)) return control;
  }
  return null;
}

async function handleCompletion(request, response) {
  let payload;
  try {
    payload = await readJson(request);
  } catch {
    json(response, 400, { error: { message: "Invalid request" } });
    return;
  }

  calls += 1;
  const control = matchingControl(payload);
  if (control) control.calls += 1;
  const mode = control?.mode ?? "success";

  if (mode === "auth_failure") {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: control.rawDetail } }));
    return;
  }
  if (mode === "timeout") {
    setTimeout(() => {
      if (!response.destroyed) streamCompletion(response);
    }, 1_000);
    return;
  }
  if (mode === "empty_output") {
    streamCompletion(response, "   \n");
    return;
  }
  streamCompletion(response);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health/live") {
    json(response, 200, { status: "live" });
    return;
  }
  if (url.pathname === "/test/stats" && request.method === "GET") {
    const correlationId = url.searchParams.get("correlationId");
    json(response, 200, { calls: correlationId === null ? calls : controls.get(correlationId)?.calls ?? 0 });
    return;
  }
  if (url.pathname === "/test/stats" && request.method === "DELETE") {
    calls = 0;
    for (const control of controls.values()) control.calls = 0;
    json(response, 200, { calls });
    return;
  }
  if (url.pathname === "/test/control" && request.method === "PUT") {
    let body;
    try {
      body = await readJson(request);
    } catch {
      json(response, 400, { error: { message: "Invalid request" } });
      return;
    }
    const allowedModes = new Set(["auth_failure", "timeout", "empty_output", "success"]);
    if (typeof body?.correlationId !== "string" || !allowedModes.has(body?.mode)) {
      json(response, 400, { error: { message: "Invalid control" } });
      return;
    }
    controls.set(body.correlationId, {
      mode: body.mode,
      rawDetail: typeof body.rawDetail === "string" ? body.rawDetail : "",
      calls: 0,
    });
    json(response, 200, { status: "configured" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    await handleCompletion(request, response);
    return;
  }
  json(response, 404, { error: { message: "Not found" } });
}).listen(port, "0.0.0.0", () => {
  console.log(`fake provider listening on ${port}`);
});
