/**
 * mem0 proxy endpoint tests — verify the workflow-side proxy forwards to the
 * mem0 server with correct auth headers and error handling. Uses a stub mem0
 * server (node:http) so no real mem0 is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.mjs";
import { ensureSchema } from "./db-schema.mjs";
import { setSetting } from "./settings.mjs";
import Database from "better-sqlite3";

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "mem0-proxy-test-"));
  const db = new Database(join(dir, "test.db"));
  ensureSchema(db);
  return { db, dir };
}

/** Spin up a stub mem0 server. Records requests for assertions. */
function startStubMem0() {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    const json = (obj, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.url === "/auth/setup-status") return json({ setup_required: false, admin_configured: true });
    if (req.url === "/configure" && req.method === "GET") {
      return json({ llm: { provider: "openai", config: { model: "deepseek-v4-flash" } } });
    }
    if (req.url === "/memories" && req.method === "POST") {
      return json({ results: [{ id: "mem-test-1", memory: "User's favorite color is blue", event: "ADD" }] }, 201);
    }
    if (req.url.startsWith("/memories?") && req.method === "GET") {
      return json({ results: [{ id: "mem-1", memory: "User likes Python", created_at: "2026-07-30T00:00:00Z" }] });
    }
    if (req.url.startsWith("/memories/mem-test-1") && req.method === "DELETE") {
      return json({ message: "Memory deleted" });
    }
    if (req.url === "/search" && req.method === "POST") {
      return json({ results: [{ id: "mem-test-1", memory: "User's favorite color is blue", score: 0.87 }] });
    }
    if (req.url === "/configure" && req.method === "POST") {
      return json({ message: "Configuration set successfully" });
    }
    return json({ detail: "not found" }, 404);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port, seen });
    });
  });
}

async function withApp(t, fn) {
  const { db, dir } = setupDb();
  const { server, port, seen } = await startStubMem0();
  try {
    setSetting(db, "mem0_host", `http://127.0.0.1:${port}`);
    setSetting(db, "mem0_api_key", "test-api-key");
    const app = createApp({ db, agentDir: dir });
    await fn({ app, seen });
  } finally {
    server.closeAllConnections?.();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("GET /api/mem0/status forwards to mem0 /auth/setup-status and /configure", async (t) => {
  await withApp(t, async ({ app, seen }) => {
    const res = await app.fetch(new Request("http://localhost/api/mem0/status"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status.status, 200);
    assert.equal(body.config.body.llm.config.model, "deepseek-v4-flash");
    // Auth header must be X-API-Key (not Authorization: Bearer).
    const statusReq = seen.find((r) => r.url === "/auth/setup-status");
    assert.equal(statusReq.headers["x-api-key"], "test-api-key");
  });
});

test("GET /api/mem0/memories?agentId= forwards with agent_id query param", async (t) => {
  await withApp(t, async ({ app, seen }) => {
    const res = await app.fetch(new Request("http://localhost/api/mem0/memories?agentId=agent-123"));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.results.length, 1);
    assert.equal(body.results[0].memory, "User likes Python");
    const req = seen.find((r) => r.url.startsWith("/memories?"));
    assert.match(req.url, /agent_id=agent-123/);
  });
});

test("POST /api/mem0/test runs connect → extract → search → cleanup steps", async (t) => {
  await withApp(t, async ({ app, seen }) => {
    const res = await app.fetch(
      new Request("http://localhost/api/mem0/test", { method: "POST", body: JSON.stringify({}) })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.steps.length, 3);
    assert.deepEqual(
      body.steps.map((s) => s.name),
      ["connect", "extract", "search"]
    );
    assert.ok(body.steps.every((s) => s.ok));
    // Cleanup happened (DELETE /memories/mem-test-1).
    assert.ok(seen.some((r) => r.method === "DELETE" && r.url.startsWith("/memories/mem-test-1")));
  });
});

test("POST /api/mem0/configure forwards llm/embedder config with admin key", async (t) => {
  // Separate app instance with admin key set.
  const { db, dir } = setupDb();
  const { server, port, seen } = await startStubMem0();
  try {
    setSetting(db, "mem0_host", `http://127.0.0.1:${port}`);
    setSetting(db, "mem0_api_key", "test-api-key");
    setSetting(db, "mem0_admin_key", "test-admin-key");
    const app = createApp({ db, agentDir: dir });
    const res = await app.fetch(
      new Request("http://localhost/api/mem0/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm_base_url: "https://example.com/api",
          llm_model: "deepseek-v4-flash",
          embedder_model: "text-embedding-v4",
          embedding_dims: 1024,
        }),
      })
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    const configureReq = seen.find((r) => r.method === "POST" && r.url === "/configure");
    assert.ok(configureReq, "POST /configure should have been forwarded");
    assert.equal(configureReq.headers["x-api-key"], "test-admin-key");
    const payload = JSON.parse(configureReq.body);
    assert.equal(payload.llm.config.model, "deepseek-v4-flash");
    assert.equal(payload.llm.config.openai_base_url, "https://example.com/api");
    assert.equal(payload.embedder.config.model, "text-embedding-v4");
    assert.equal(payload.embedder.config.embedding_dims, 1024);
  } finally {
    server.closeAllConnections?.();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/mem0/* returns 400 when mem0 is not configured", async (t) => {
  const { db, dir } = setupDb();
  try {
    const app = createApp({ db, agentDir: dir });
    const res = await app.fetch(new Request("http://localhost/api/mem0/status"));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /not configured/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
