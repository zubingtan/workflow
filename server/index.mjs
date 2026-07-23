import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { nanoid } from "nanoid";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { initRuntime, createAgentSessionForAgent, TaskRunAPI, TaskReportAPI, TaskCancelAPI, TaskValidateAPI } from "./runtime-adapter.mjs";

// --- Config ---
const PORT = Number(process.env.SERVER_PORT ?? 4001);
const DATA_DIR = join(homedir(), ".config", "workflow");
const DB_PATH = join(DATA_DIR, "workflow.db");
const AGENT_DIR = join(DATA_DIR, "agents");

// --- SQLite init ---
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(AGENT_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_base_url TEXT NOT NULL,
    provider_api_key_env TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt TEXT DEFAULT '',
    temperature REAL DEFAULT 0.7,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// --- Hono app ---
const app = new Hono();

app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (c.req.method === "OPTIONS") return c.text("", 204);
  await next();
});

app.get("/health/live", (c) => c.json({ status: "live" }));

// --- Workflow CRUD ---
app.get("/workflows", (c) => {
  const rows = db.prepare("SELECT id, name, created_at, updated_at FROM workflows ORDER BY created_at DESC").all();
  return c.json(rows);
});

app.get("/workflows/:id", (c) => {
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ ...row, data: JSON.parse(row.data) });
});

app.post("/workflows", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body || typeof body !== "object" || !body.name) return c.json({ error: "name is required" }, 400);
  const id = nanoid(10);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)").run(
    id, body.name, JSON.stringify(body.data ?? {})
  );
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
  return c.json({ ...row, data: JSON.parse(row.data) }, 201);
});

app.put("/workflows/:id", async (c) => {
  const id = c.req.param("id");
  const existing = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "not found" }, 404);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "body must be an object" }, 400);
  const name = body.name ?? existing.name;
  const data = body.data !== undefined ? JSON.stringify(body.data) : existing.data;
  db.prepare("UPDATE workflows SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?").run(name, data, id);
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
  return c.json({ ...row, data: JSON.parse(row.data) });
});

app.delete("/workflows/:id", (c) => {
  const result = db.prepare("DELETE FROM workflows WHERE id = ?").run(c.req.param("id"));
  if (result.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

app.post("/workflows/:id/copy", (c) => {
  const src = db.prepare("SELECT * FROM workflows WHERE id = ?").get(c.req.param("id"));
  if (!src) return c.json({ error: "not found" }, 404);
  const id = nanoid(10);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)").run(id, `${src.name} (copy)`, src.data);
  const row = db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
  return c.json({ ...row, data: JSON.parse(row.data) }, 201);
});

// --- Agent copy ---
app.post("/agents/:id/copy", (c) => {
  const src = db.prepare("SELECT * FROM agents WHERE id = ?").get(c.req.param("id"));
  if (!src) return c.json({ error: "not found" }, 404);
  const id = nanoid(10);
  db.prepare(`INSERT INTO agents (id, name, provider_base_url, provider_api_key_env, model, system_prompt, temperature)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, `${src.name} (copy)`, src.provider_base_url, src.provider_api_key_env, src.model, src.system_prompt, src.temperature
  );
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  return c.json(row, 201);
});

// --- Agent CRUD ---
app.get("/agents", (c) => {
  const agents = db.prepare("SELECT * FROM agents ORDER BY created_at DESC").all();
  return c.json(agents);
});

app.post("/agents", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "body must be an object" }, 400);
  const { name, provider_base_url, provider_api_key_env, model, system_prompt, temperature } = body;
  if (!name || !provider_base_url || !provider_api_key_env || !model) {
    return c.json({ error: "name, provider_base_url, provider_api_key_env, model are required" }, 400);
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(provider_api_key_env)) {
    return c.json({ error: "provider_api_key_env must be UPPER_SNAKE_CASE" }, 400);
  }
  const id = nanoid(10);
  db.prepare(`
    INSERT INTO agents (id, name, provider_base_url, provider_api_key_env, model, system_prompt, temperature)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, provider_base_url, provider_api_key_env, model, system_prompt ?? "", temperature ?? 0.7);
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  return c.json(agent, 201);
});

app.put("/agents/:id", async (c) => {
  const { id } = c.req.param();
  const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "not found" }, 404);

  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "body must be an object" }, 400);
  if (body.provider_api_key_env && !/^[A-Z][A-Z0-9_]*$/.test(body.provider_api_key_env)) {
    return c.json({ error: "provider_api_key_env must be UPPER_SNAKE_CASE" }, 400);
  }
  const fields = ["name", "provider_base_url", "provider_api_key_env", "model", "system_prompt", "temperature"];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (body[f] !== undefined && body[f] !== null) {
      updates.push(`${f} = ?`);
      values.push(body[f]);
    }
  }
  if (updates.length === 0) return c.json(existing);
  updates.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  return c.json(agent);
});

app.delete("/agents/:id", (c) => {
  const { id } = c.req.param();
  const result = db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  if (result.changes === 0) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// --- Env vars (names only, for autocomplete; localhost-only) ---
app.get("/env/vars", (c) => {
  const origin = c.req.header("origin") || "";
  const isLocal = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!isLocal) return c.json({ error: "forbidden" }, 403);
  const names = Object.keys(process.env)
    .filter((k) => /^[A-Z][A-Z0-9_]*$/.test(k))
    .filter((k) => /(_API_KEY|_KEY|_TOKEN|_URL|_BASE|_HOST|_SECRET)$/.test(k))
    .sort();
  return c.json(names);
});

// --- Shared agent execution (SSE) ---
async function runAgentSse(c, agentConfig, prompt) {
  const apiKey = process.env[agentConfig.provider_api_key_env];
  if (!apiKey) {
    return c.json({ error: `missing env var: ${agentConfig.provider_api_key_env}` }, 500);
  }

  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    let session;
    let unsubscribe;
    try {
      session = await createAgentSessionForAgent(agentConfig, apiKey, AGENT_DIR);

      stream.onAbort(() => { session?.agent?.abort?.(); });

      unsubscribe = session.subscribe(async (event) => {
        if (stream.aborted) return;
        const mapped = mapEvent(event);
        for (const msg of mapped) {
          await stream.writeSSE({ data: JSON.stringify(msg) });
        }
      });

      await session.prompt(prompt);
      await session.agent.waitForIdle();

      if (!stream.aborted) {
        await stream.writeSSE({ data: JSON.stringify({ type: "finish" }) });
      }
    } catch (err) {
      if (!stream.aborted) {
        await stream.writeSSE({
          data: JSON.stringify({ type: "error", message: err?.message ?? "internal error" }),
        });
      }
    } finally {
      unsubscribe?.();
      session?.dispose?.();
    }
  });
}

// --- Agent Run (SSE) ---
app.post("/agents/:id/run", async (c) => {
  const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(c.req.param("id"));
  if (!agent) return c.json({ error: "agent not found" }, 404);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body?.prompt) return c.json({ error: "prompt is required" }, 400);
  return runAgentSse(c, agent, body.prompt);
});

// --- Agent Test (SSE) — test a config without saving ---
app.post("/agents/test", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  const { name, provider_base_url, provider_api_key_env, model, system_prompt, prompt } = body ?? {};
  if (!provider_base_url || !provider_api_key_env || !model) {
    return c.json({ error: "provider_base_url, provider_api_key_env, model are required" }, 400);
  }
  return runAgentSse(c, { name: name ?? "test", provider_base_url, provider_api_key_env, model, system_prompt }, prompt || "Say hello in one sentence.");
});

// --- Event mapping: pi AgentSessionEvent → generic SSE events ---
function mapEvent(event) {
  switch (event.type) {
    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e?.type === "text_delta" && e.delta) {
        return [{ type: "content_delta", content: e.delta }];
      }
      return [];
    }
    case "tool_execution_start":
      return [{ type: "tool_start", toolName: event.toolName, args: event.args }];
    case "tool_execution_end":
      return [{ type: "tool_end", toolName: event.toolName, result: event.result, isError: event.isError }];
    case "agent_end":
      return [];  // handled by finish after waitForIdle
    default:
      return [];
  }
}

// --- Seed fake-provider agent if empty ---
const agentCount = db.prepare("SELECT COUNT(*) as c FROM agents").get().c;
if (agentCount === 0) {
  db.prepare(`INSERT INTO agents (id, name, provider_base_url, provider_api_key_env, model, system_prompt, temperature)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    "fake-default", "Fake Provider", "http://localhost:4010/v1", "FAKE_PROVIDER_API_KEY", "fake-model", "You are a helpful assistant.", 0.7
  );
  console.log("  seeded fake-provider agent");
}

// --- Init runtime (register AgentExecutor to replace built-in LLMExecutor) ---
initRuntime(db, AGENT_DIR);

// --- FlowGram server protocol endpoints (for browser Test Run via server mode) ---
app.post("/api/task/validate", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body?.schema) return c.json({ error: "schema is required" }, 400);
  const schema = typeof body.schema === "string" ? body.schema : JSON.stringify(body.schema);
  try {
    const result = await TaskValidateAPI({ schema, inputs: body.inputs ?? {} });
    return c.json(result);
  } catch (err) {
    return c.json({ code: -1, error: err?.message ?? "validate failed" }, 500);
  }
});

app.post("/api/task/run", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body?.schema) return c.json({ error: "schema is required" }, 400);
  const schema = typeof body.schema === "string" ? body.schema : JSON.stringify(body.schema);
  try {
    const result = await TaskRunAPI({ schema, inputs: body.inputs ?? {} });
    return c.json(result);
  } catch (err) {
    return c.json({ code: -1, error: err?.message ?? "task run failed" }, 500);
  }
});

app.get("/api/task/report", async (c) => {
  const taskID = c.req.query("taskID");
  if (!taskID) return c.json({ error: "taskID is required" }, 400);
  try {
    const report = await TaskReportAPI({ taskID });
    return c.json(report);
  } catch (err) {
    return c.json({ code: -1, error: err?.message ?? "report failed" }, 500);
  }
});

app.put("/api/task/cancel", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body?.taskID) return c.json({ error: "taskID is required" }, 400);
  try {
    const result = await TaskCancelAPI({ taskID: body.taskID });
    return c.json(result);
  } catch (err) {
    return c.json({ code: -1, error: err?.message ?? "cancel failed" }, 500);
  }
});

// --- Start ---
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`workflow agent server listening on http://localhost:${info.port}`);
  console.log(`  data: ${DATA_DIR}`);
  console.log(`  db: ${DB_PATH}`);
});

// --- Graceful shutdown ---
function shutdown() {
  console.log("shutting down...");
  db.close();
  server.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
