import { createServer } from "node:http";

const port = Number(process.env.WORKER_HEALTH_PORT ?? 4011);

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health/live") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "live" }));
    return;
  }
  response.writeHead(404).end();
}).listen(port, "0.0.0.0", () => {
  console.log(`worker health listening on ${port}`);
});
