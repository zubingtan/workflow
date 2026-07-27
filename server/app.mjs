/**
 * Hono app factory — shared between dev (rsbuild middlewareMode) and prod
 * (Hono serves dist/ via @hono/node-server/serve-static).
 *
 * Pure: no DB init, no serve(), no process.exit. The caller owns all
 * side-effects (DB connection, runtime init, SSE adapter binding, server
 * lifecycle). This makes the app testable via `app.fetch(new Request(...))`
 * without spawning a real HTTP server (#116 T4 TDD).
 *
 * Route registration order matters (T2 #118 decision): API routes first →
 * /static/* → /, /index.html, /favicon.ico → app.get("*") SPA fallback.
 * POST/PUT/DELETE to unknown paths fall through to Hono's 404 (the SPA
 * fallback only matches GET), so mistyped write APIs are not silently
 * swallowed by index.html.
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { nanoid } from "nanoid";
import {
  AgentExecutionError,
  TaskRunAPI,
  TaskReportAPI,
  TaskCancelAPI,
  TaskValidateAPI,
  TaskResultAPI,
} from "./runtime-adapter.mjs";
import { createRunAgentSse } from "./sse-adapter.mjs";
import {
  AgentCatalogError,
  validateTemperature,
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

/**
 * Translate a thrown error from the task layer into a {code, message} JSON
 * response (#56 decision 3).
 */
function taskErrorResponse(err, fallback) {
  if (err instanceof AgentExecutionError) {
    return { code: err.kind, message: err.message, detail: err.detail };
  }
  return { code: "internal_error", message: err?.message ?? fallback };
}

function workflowHashFromSchema(schema) {
  const s = typeof schema === "string" ? schema : JSON.stringify(schema);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `wf_${(h >>> 0).toString(36)}`;
}

/**
 * @param {object} deps
 * @param {import("better-sqlite3").Database} deps.db
 * @param {string} deps.agentDir
 * @param {boolean} [deps.staticEnabled=false] - prod serves dist/, dev does not
 * @param {string} [deps.staticDir] - root for serveStatic (defaults to ./dist)
 * @param {object} [deps.runAgentExecution] - injected for tests
 * @param {object} [deps.createAgentSessionForAgent] - injected for tests
 * @param {(c: object, handler: (stream: object) => Promise<void>) => Promise<void>} [deps.streamSSE]
 *   Inject a fake streamSSE for tests to bypass Hono's streaming layer.
 * @returns {Hono}
 */
export function createApp({
  db,
  agentDir,
  staticEnabled = false,
  staticDir,
  runAgentExecution,
  createAgentSessionForAgent,
  streamSSE,
}) {
  const app = new Hono();

  // --- SSE adapter (credential boundary preserved — see server/index.mjs) ---
  const runAgentSse = createRunAgentSse({
    runAgentExecution,
    createAgentSessionForAgent,
    agentDir,
    ...(streamSSE ? { streamSSE } : {}),
  });

  // --- Per-workflow task mutex (#56 decision 4) ---
  const runningTasks = new Map();
  const workflowLocks = new Map();
  const TASK_TTL_MS = 5 * 60 * 1000;
  const TASK_SWEEP_DELAY_MS = 60 * 1000;

  function releaseTaskLock(taskID) {
    const entry = runningTasks.get(taskID);
    if (!entry) return;
    runningTasks.delete(taskID);
    if (workflowLocks.get(entry.workflowHash) === taskID) {
      workflowLocks.delete(entry.workflowHash);
    }
  }

  function markTaskTerminated(taskID) {
    const entry = runningTasks.get(taskID);
    if (!entry || entry.terminatedAt) return;
    entry.terminatedAt = Date.now();
    if (workflowLocks.get(entry.workflowHash) === taskID) {
      workflowLocks.delete(entry.workflowHash);
    }
  }

  const sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [taskID, entry] of runningTasks) {
      if (entry.terminatedAt) {
        if (now - entry.terminatedAt > TASK_SWEEP_DELAY_MS) {
          runningTasks.delete(taskID);
        }
      } else if (now - entry.startedAt > TASK_TTL_MS) {
        markTaskTerminated(taskID);
      }
    }
  }, 60_000);
  sweepTimer.unref?.();

  // --- CORS (dev origin; harmless in prod where same-origin) ---
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
  app.get("/agents", (c) => c.json(listAgents(db)));

  app.get("/agents/:id", (c) => {
    const agent = getAgentById(db, c.req.param("id"));
    if (!agent) return c.json({ error: "not found" }, 404);
    return c.json(agent);
  });

  app.post("/agents", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
    if (!body || typeof body !== "object") return c.json({ error: "body must be an object" }, 400);
    const { name, provider_base_url, provider_api_key, model, system_prompt, temperature } = body;
    if (!name || !provider_base_url || !provider_api_key || !model) {
      return c.json({ error: "name, provider_base_url, provider_api_key, model are required" }, 400);
    }
    try {
      const agent = createAgent(db, { name, provider_base_url, provider_api_key, model, system_prompt, temperature });
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

  // --- Agent Run (SSE) ---
  app.post("/agents/:id/run", async (c) => {
    const agent = getAgentById(db, c.req.param("id"));
    if (!agent) return c.json({ error: "agent not found" }, 404);
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
    if (!body?.prompt) return c.json({ error: "prompt is required" }, 400);
    return runAgentSse(c, agent, body.prompt);
  });

  // --- Agent Test (SSE) ---
  app.post("/agents/test", async (c) => {
    let body;
    try { body = await c.req.json(); } catch { return c.json({ error: "invalid JSON" }, 400); }
    const { name, provider_base_url, provider_api_key, model, system_prompt, temperature, prompt } = body ?? {};
    if (!provider_base_url || !provider_api_key || !model) {
      return c.json({ error: "provider_base_url, provider_api_key, model are required" }, 400);
    }
    try {
      validateTemperature(temperature);
    } catch (err) {
      const translated = catalogErrorResponse(err);
      if (translated) return c.json(translated.body, translated.status);
      throw err;
    }
    return runAgentSse(c, { name: name ?? "test", provider_base_url, provider_api_key, model, system_prompt, temperature: temperature ?? 0.7 }, prompt || "Say hello in one sentence.");
  });

  // --- FlowGram task endpoints ---
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
      runningTasks.delete(placeholderID);
      runningTasks.set(result.taskID, { workflowHash: wfHash, taskID: result.taskID, startedAt: Date.now() });
      workflowLocks.set(wfHash, result.taskID);
      return c.json(result);
    } catch (err) {
      releaseTaskLock(placeholderID);
      return c.json(taskErrorResponse(err, "task run failed"), 500);
    }
  });

  app.get("/api/task/report", async (c) => {
    const taskID = c.req.query("taskID");
    if (!taskID) return c.json({ error: "taskID is required" }, 400);
    try {
      const report = await TaskReportAPI({ taskID });
      if (report && (report.status === "success" || report.status === "failed" || report.status === "cancelled")) {
        releaseTaskLock(taskID);
      }
      return c.json(report);
    } catch (err) {
      return c.json(taskErrorResponse(err, "report failed"), 500);
    }
  });

  app.get("/api/task/result", async (c) => {
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
      if (result?.success) releaseTaskLock(body.taskID);
      return c.json(result);
    } catch (err) {
      return c.json(taskErrorResponse(err, "cancel failed"), 500);
    }
  });

  // --- Static serving + SPA fallback (prod only; dev mode uses rsbuild) ---
  if (staticEnabled) {
    const root = staticDir ?? "./dist";

    // Cache-control wrapper. serveStatic returns the Response directly (it
    // does NOT set c.res — `c.body()` constructs but doesn't assign). Hono's
    // `c.res` getter lazily creates an *empty* 200 Response, so reading
    // `c.res.status` after a miss is misleadingly 200 with null body. We must
    // capture serveStatic's return value: a Response on hit, or the result
    // of `next()` (Context) on miss.
    const withCache = (handler, cacheControl) => async (c, next) => {
      const res = await handler(c, next);
      if (res instanceof Response && res.status === 200) {
        const headers = new Headers(res.headers);
        headers.set("Cache-Control", cacheControl);
        // Rebuild with the same stream body so the readable stream stays intact.
        const cached = new Response(res.body, { status: 200, headers });
        c.res = cached;
        return cached;
      }
      // Miss (res is Context from next()) or non-200 — pass through unchanged.
      return res;
    };

    // Hash-named assets under /static/* → immutable long cache. rsbuild
    // emits [name].[contenthash:8][ext] by default, so every file under
    // /static/* is content-hashed and safe to cache forever.
    app.use(
      "/static/*",
      withCache(serveStatic({ root }), "public, max-age=31536000, immutable")
    );

    // index.html — never cached (must pick up new deploys immediately).
    // `path: "index.html"` ignores the request URL and serves that file
    // fixed (serve-static.mjs:77), which is exactly SPA fallback semantics.
    // @hono/node-server@2.0.10 has no `fallback` option, so `path` is the
    // official SPA fallback idiom (T2 #118 decision).
    const noCacheHtml = withCache(
      serveStatic({ root, path: "index.html" }),
      "no-cache"
    );
    app.get("/", noCacheHtml);
    app.get("/index.html", noCacheHtml);

    // favicon.ico — short cache (may change between deploys).
    app.get(
      "/favicon.ico",
      withCache(
        serveStatic({ root, path: "favicon.ico" }),
        "public, max-age=3600"
      )
    );

    // SPA fallback — unknown GET paths return index.html so client-side
    // routing works. Only matches GET; POST/PUT/DELETE to unknown paths
    // fall through to Hono's 404 (T2 #118 — write APIs not silently
    // swallowed by index.html).
    app.get("*", noCacheHtml);
  }

  return app;
}
