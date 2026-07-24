import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { nanoid } from "nanoid";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  initRuntime,
  createAgentSessionForAgent,
  AgentExecutionError,
  TaskRunAPI,
  TaskReportAPI,
  TaskCancelAPI,
  TaskValidateAPI,
  TaskResultAPI,
} from "./runtime-adapter.mjs";
import { runAgentExecution } from "./agent-execution.mjs";
import { createRunAgentSse } from "./sse-adapter.mjs";
import {
  AgentCatalogError,
  validateTemperature,
  validateProviderApiKeyEnv,
  listAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  copyAgent,
  seedAgentIfEmpty,
} from "./agent-catalog.mjs";

/**
 * Translate a thrown AgentCatalogError into a 400 JSON response. Non-catalog
 * errors are rethrown so Hono's default 500 handler (or the task-error
 * translation above) takes them. Collapses the 3× repeated try/catch blocks
 * that POST/PUT /agents and /agents/test would otherwise each spell out.
 */
function catalogErrorResponse(err) {
  if (err instanceof AgentCatalogError) {
    return { body: { error: err.message, code: err.code }, status: 400 };
  }
  return null;
}

// --- Config ---
const PORT = Number(process.env.SERVER_PORT ?? 4001);
// WORKFLOW_DATA_DIR overrides the default ~/.config/workflow/ data dir —
// used by E2E tests to isolate SQLite state. Defaults to the canonical path.
const DATA_DIR = process.env.WORKFLOW_DATA_DIR
  ? resolve(process.env.WORKFLOW_DATA_DIR)
  : join(homedir(), ".config", "workflow");
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

// --- SSE adapter instance (bound to the shared Agent Execution module) ---
// Credential boundary: the adapter resolves apiKey from process.env and binds
// it into a createSession closure before calling runAgentExecution. The shared
// module never resolves credentials (#66 rule, aligned by #76/#77 calibration).
const runAgentSse = createRunAgentSse({
  runAgentExecution,
  createAgentSessionForAgent,
  agentDir: AGENT_DIR,
  environment: process.env,
});

// --- Per-workflow task mutex (#56 decision 4) ---
// Keyed by workflow content hash so concurrent runs of the SAME workflow
// definition get a 409, while different workflows run in parallel.
//
// TTL cleanup is two-phase (#78 item 3): when a task exceeds TASK_TTL_MS
// without a terminal callback (e.g. server crash mid-run), phase 1 MARKS it
// terminated — releases the workflow lock so new runs can start, but keeps the
// runningTasks entry with a `terminatedAt` timestamp. Phase 2 SWEEPS the entry
// ~60s later. This avoids a polling race where a client re-polls just as the
// lock is cleared and sees an empty report.
const runningTasks = new Map(); // taskID → { workflowHash, taskID, startedAt, terminatedAt? }
const workflowLocks = new Map(); // workflowHash → taskID
const TASK_TTL_MS = 5 * 60 * 1000; // 5 min: mark as terminated if no terminal callback
const TASK_SWEEP_DELAY_MS = 60 * 1000; // 60s: remove marked entries after this grace window

function workflowHashFromSchema(schema) {
  // The schema is the serialized workflow definition. Hash it so structurally
  // identical workflows collide (same nodes/edges/inputs → same hash).
  // Simple non-crypto hash is fine: this is a mutex key, not security.
  const s = typeof schema === "string" ? schema : JSON.stringify(schema);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `wf_${(h >>> 0).toString(36)}`;
}

/**
 * Release a task's workflow lock immediately. Used when the task has a genuine
 * terminal callback (report shows success/failed/cancelled, or cancel API
 * succeeded) — in those cases the runtime confirmed termination, so there's no
 * polling race and we can delete the entry outright.
 */
function releaseTaskLock(taskID) {
  const entry = runningTasks.get(taskID);
  if (!entry) return;
  runningTasks.delete(taskID);
  if (workflowLocks.get(entry.workflowHash) === taskID) {
    workflowLocks.delete(entry.workflowHash);
  }
}

/**
 * Phase 1 of TTL cleanup: MARK a stale task as terminated. Releases the
 * workflow lock (so new runs of the same workflow can proceed) but KEEPS the
 * runningTasks entry with a `terminatedAt` timestamp so a subsequent sweep can
 * remove it after the grace window (#78 item 3).
 */
function markTaskTerminated(taskID) {
  const entry = runningTasks.get(taskID);
  if (!entry || entry.terminatedAt) return;
  entry.terminatedAt = Date.now();
  if (workflowLocks.get(entry.workflowHash) === taskID) {
    workflowLocks.delete(entry.workflowHash);
  }
}

// Periodic sweep — runs both phases each tick:
//   - Phase 1 (mark): entries past TASK_TTL_MS with no terminatedAt → mark
//   - Phase 2 (sweep): entries whose terminatedAt is older than TASK_SWEEP_DELAY_MS → delete
setInterval(() => {
  const now = Date.now();
  for (const [taskID, entry] of runningTasks) {
    if (entry.terminatedAt) {
      // Phase 2: sweep marked entries after the grace window.
      if (now - entry.terminatedAt > TASK_SWEEP_DELAY_MS) {
        runningTasks.delete(taskID);
      }
    } else if (now - entry.startedAt > TASK_TTL_MS) {
      // Phase 1: mark stale entries as terminated (keeps the entry, releases
      // the workflow lock).
      markTaskTerminated(taskID);
    }
  }
}, 60_000).unref?.();

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
  const copied = copyAgent(db, c.req.param("id"));
  if (!copied) return c.json({ error: "not found" }, 404);
  return c.json(copied, 201);
});

// --- Agent CRUD ---
app.get("/agents", (c) => {
  return c.json(listAgents(db));
});

// #55 decision: new GET /agents/:id — single-agent fetch for the browser hook.
app.get("/agents/:id", (c) => {
  const agent = getAgentById(db, c.req.param("id"));
  if (!agent) return c.json({ error: "not found" }, 404);
  return c.json(agent);
});

app.post("/agents", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "body must be an object" }, 400);
  const { name, provider_base_url, provider_api_key_env, model, system_prompt, temperature } = body;
  if (!name || !provider_base_url || !provider_api_key_env || !model) {
    return c.json({ error: "name, provider_base_url, provider_api_key_env, model are required" }, 400);
  }
  try {
    const agent = createAgent(db, { name, provider_base_url, provider_api_key_env, model, system_prompt, temperature });
    return c.json(agent, 201);
  } catch (err) {
    const translated = catalogErrorResponse(err);
    if (translated) return c.json(translated.body, translated.status);
    throw err;
  }
});

app.put("/agents/:id", async (c) => {
  const { id } = c.req.param();
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "body must be an object" }, 400);
  try {
    const agent = updateAgent(db, id, body);
    if (!agent) return c.json({ error: "not found" }, 404);
    return c.json(agent);
  } catch (err) {
    const translated = catalogErrorResponse(err);
    if (translated) return c.json(translated.body, translated.status);
    throw err;
  }
});

app.delete("/agents/:id", (c) => {
  const ok = deleteAgent(db, c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
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

// --- Agent Run (SSE) ---
app.post("/agents/:id/run", async (c) => {
  const agent = getAgentById(db, c.req.param("id"));
  if (!agent) return c.json({ error: "agent not found" }, 404);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body?.prompt) return c.json({ error: "prompt is required" }, 400);
  return runAgentSse(c, agent, body.prompt);
});

// --- Agent Test (SSE) — test a config without saving ---
// #55 decision: accepts the full agent fields (including temperature) so the
// test reflects what would actually be persisted. Previously temperature was
// dropped, masking provider behavior differences. Validation is owned by the
// catalog (validateTemperature / validateProviderApiKeyEnv) — this route only
// checks required-ness and translates catalog errors to 400s.
app.post("/agents/test", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  const { name, provider_base_url, provider_api_key_env, model, system_prompt, temperature, prompt } = body ?? {};
  if (!provider_base_url || !provider_api_key_env || !model) {
    return c.json({ error: "provider_base_url, provider_api_key_env, model are required" }, 400);
  }
  try {
    validateTemperature(temperature);
    validateProviderApiKeyEnv(provider_api_key_env);
  } catch (err) {
    const translated = catalogErrorResponse(err);
    if (translated) return c.json(translated.body, translated.status);
    throw err;
  }
  return runAgentSse(c, { name: name ?? "test", provider_base_url, provider_api_key_env, model, system_prompt, temperature: temperature ?? 0.7 }, prompt || "Say hello in one sentence.");
});

// --- Seed fake-provider agent if empty ---
const seeded = seedAgentIfEmpty(db, {
  id: "fake-default",
  name: "Fake Provider",
  provider_base_url: "http://localhost:4010/v1",
  provider_api_key_env: "FAKE_PROVIDER_API_KEY",
  model: "fake-model",
  system_prompt: "You are a helpful assistant.",
  temperature: 0.7,
});
if (seeded) console.log("  seeded fake-provider agent");

// --- Init runtime (register AgentExecutor to replace built-in LLMExecutor) ---
initRuntime(db, AGENT_DIR);

// --- FlowGram server protocol endpoints (for browser Test Run via server mode) ---

/**
 * Translate a thrown error from the task layer into a {code, message} JSON
 * response (#56 decision 3). AgentExecutionError carries a machine-readable
 * `kind`; other errors get a generic internal_error code. `code` is always a
 * string so the browser client's isError() check (code !== undefined) fires.
 */
function taskErrorResponse(err, fallback) {
  if (err instanceof AgentExecutionError) {
    return { code: err.kind, message: err.message, detail: err.detail };
  }
  return { code: "internal_error", message: err?.message ?? fallback };
}

app.post("/api/task/validate", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body?.schema) return c.json({ error: "schema is required" }, 400);
  const schema = typeof body.schema === "string" ? body.schema : JSON.stringify(body.schema);
  try {
    const result = await TaskValidateAPI({ schema, inputs: body.inputs ?? {} });
    return c.json(result);
  } catch (err) {
    return c.json(taskErrorResponse(err, "validate failed"), 500);
  }
});

app.post("/api/task/run", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body?.schema) return c.json({ error: "schema is required" }, 400);
  const schema = typeof body.schema === "string" ? body.schema : JSON.stringify(body.schema);

  // Per-workflow mutex (#56 decision 4): reject concurrent runs of the SAME
  // workflow definition with 409. Different workflows run in parallel.
  //
  // Lock acquisition is SYNCHRONOUS before the await on TaskRunAPI to avoid a
  // TOCTOU race: if the check-and-set happened after the await, two concurrent
  // same-workflow requests would both pass the empty-check, both call TaskRunAPI,
  // and the second set() would orphan the first task. We reserve the lock with
  // a placeholder taskID, then patch in the real taskID once TaskRunAPI returns.
  const wfHash = workflowHashFromSchema(schema);
  const existingTaskID = workflowLocks.get(wfHash);
  if (existingTaskID && runningTasks.has(existingTaskID)) {
    return c.json({ code: "workflow_busy", message: "workflow already running", taskID: existingTaskID }, 409);
  }
  const placeholderID = `pending_${nanoid(10)}`;
  runningTasks.set(placeholderID, { workflowHash: wfHash, taskID: placeholderID, startedAt: Date.now() });
  workflowLocks.set(wfHash, placeholderID);

  try {
    const result = await TaskRunAPI({ schema, inputs: body.inputs ?? {} });
    // Patch the placeholder with the real taskID. Released by cancel, by the
    // TTL sweep, or by a subsequent run that finds the task gone.
    runningTasks.delete(placeholderID);
    runningTasks.set(result.taskID, { workflowHash: wfHash, taskID: result.taskID, startedAt: Date.now() });
    workflowLocks.set(wfHash, result.taskID);
    return c.json(result);
  } catch (err) {
    // TaskRunAPI failed — release the placeholder so the workflow isn't stuck.
    releaseTaskLock(placeholderID);
    return c.json(taskErrorResponse(err, "task run failed"), 500);
  }
});

app.get("/api/task/report", async (c) => {
  const taskID = c.req.query("taskID");
  if (!taskID) return c.json({ error: "taskID is required" }, 400);
  try {
    const report = await TaskReportAPI({ taskID });
    // If the task has terminated, release its workflow lock (#56 decision 5).
    if (report && (report.status === "success" || report.status === "failed" || report.status === "cancelled")) {
      releaseTaskLock(taskID);
    }
    return c.json(report);
  } catch (err) {
    return c.json(taskErrorResponse(err, "report failed"), 500);
  }
});

app.get("/api/task/result", async (c) => {
  // #56 decision 1: re-export TaskResultAPI so the browser can fetch the final
  // outputs (including _executionDetail) once a task terminates. Returns
  // undefined (→ empty 200) if the task hasn't terminated yet.
  const taskID = c.req.query("taskID");
  if (!taskID) return c.json({ error: "taskID is required" }, 400);
  try {
    const result = await TaskResultAPI({ taskID });
    return c.json(result ?? {});
  } catch (err) {
    return c.json(taskErrorResponse(err, "result failed"), 500);
  }
});

app.put("/api/task/cancel", async (c) => {
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
  if (!body?.taskID) return c.json({ error: "taskID is required" }, 400);
  try {
    const result = await TaskCancelAPI({ taskID: body.taskID });
    // Release the workflow lock immediately on cancel — the task is terminal.
    if (result?.success) releaseTaskLock(body.taskID);
    return c.json(result);
  } catch (err) {
    return c.json(taskErrorResponse(err, "cancel failed"), 500);
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
