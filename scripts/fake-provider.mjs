import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const port = Number(process.env.FAKE_PROVIDER_PORT ?? 4010);

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health/live") {
    json(response, 200, { status: "live" });
    return;
  }

  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    json(response, 200, {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "fake-m0",
      choices: [{
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: "Fake provider response" },
      }],
      usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
    });
    return;
  }

  json(response, 404, { error: { message: "Not found" } });
}).listen(port, "0.0.0.0", () => {
  console.log(`fake provider listening on ${port}`);
});
