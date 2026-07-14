import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.FAKE_PROVIDER_PORT ?? 4010);
let calls = 0;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function streamCompletion(response) {
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
      delta: { role: "assistant", content: "Fake provider response" },
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

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health/live") {
    json(response, 200, { status: "live" });
    return;
  }
  if (request.url === "/test/stats" && request.method === "GET") {
    json(response, 200, { calls });
    return;
  }
  if (request.url === "/test/stats" && request.method === "DELETE") {
    calls = 0;
    json(response, 200, { calls });
    return;
  }
  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    calls += 1;
    request.resume();
    request.once("end", () => streamCompletion(response));
    return;
  }
  json(response, 404, { error: { message: "Not found" } });
}).listen(port, "0.0.0.0", () => {
  console.log(`fake provider listening on ${port}`);
});
