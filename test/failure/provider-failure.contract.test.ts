import { createServer, type Server, type ServerResponse } from "node:http";
import { inspect } from "node:util";
import { afterEach, describe, expect, test } from "vitest";

const adapterModule = "../../scripts/pi-runtime-adapter.mjs";
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

function stream(response: ServerResponse, content: string) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({
    id: "failure-contract",
    object: "chat.completion.chunk",
    created: 1,
    model: "fake-m0",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  })}\n\n`);
  response.write(`data: ${JSON.stringify({
    id: "failure-contract",
    object: "chat.completion.chunk",
    created: 1,
    model: "fake-m0",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  })}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function provider(mode: "auth" | "timeout" | "empty") {
  let calls = 0;
  const rawMarker = `RAW_PROVIDER_DETAIL_${crypto.randomUUID()}`;
  const server = createServer((request, response) => {
    calls += 1;
    request.resume();
    request.once("end", () => {
      if (mode === "auth") {
        response.writeHead(401, {
          "content-type": "application/json",
          "x-provider-detail": rawMarker,
        });
        response.end(JSON.stringify({ error: { message: rawMarker } }));
      } else if (mode === "empty") {
        stream(response, "   \n");
      } else {
        setTimeout(() => {
          if (!response.destroyed) stream(response, "too late");
        }, 500);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test provider did not bind");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    calls: () => calls,
    rawMarker,
  };
}

async function adapterError(mode: "auth" | "timeout" | "empty") {
  const fake = await provider(mode);
  const { runPiAgent } = await import(adapterModule);
  let error: any;
  try {
    await runPiAgent({
      prompt: "classify the provider failure",
      provider: "openai-compatible",
      baseUrl: fake.baseUrl,
      apiKey: "UNIT_TEST_KEY_MUST_NOT_ESCAPE",
      model: "fake-m0",
      parameters: { temperature: 0 },
      timeoutMs: 100,
    });
  } catch (caught) {
    error = caught;
  }
  return { error, fake };
}

function expectSafeError(error: any, code: string, message: string, forbidden: string[]) {
  expect(error !== undefined).toBe(true);
  expect(error?.code === code).toBe(true);
  expect(error?.message === message).toBe(true);
  const serialized = [
    String(error),
    typeof error?.stack === "string" ? error.stack : "",
    inspect(error, { depth: 8, showHidden: true }),
    inspect(error?.cause, { depth: 8, showHidden: true }),
    ...Reflect.ownKeys(error ?? {}).map((key) => inspect(error[key], { depth: 8, showHidden: true })),
  ].join("\n");
  for (const value of forbidden) expect(serialized.includes(value)).toBe(false);
}

describe("M0-T06/T07/T07E Pi adapter terminal failures", () => {
  test.each([
    ["auth", "provider_auth_failed", "Provider authentication failed"],
    ["empty", "provider_empty_output", "Provider returned empty output"],
  ] as const)("%s is classified safely after one request", async (mode, code, message) => {
    const { error, fake } = await adapterError(mode);
    expectSafeError(error, code, message, [
      fake.rawMarker,
      fake.baseUrl,
      "UNIT_TEST_KEY_MUST_NOT_ESCAPE",
      "apiKeyEnv",
      "PiSession",
      "sessionId",
    ]);
    expect(fake.calls()).toBe(1);
  });

  test("timeout aborts once and never retries", async () => {
    const started = Date.now();
    const { error, fake } = await adapterError("timeout");
    expectSafeError(error, "provider_timeout", "Provider request timed out", [
      fake.baseUrl,
      "UNIT_TEST_KEY_MUST_NOT_ESCAPE",
    ]);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(fake.calls()).toBe(1);
  }, 3_000);
});
