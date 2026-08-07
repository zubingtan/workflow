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
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { streamSSE as honoStreamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import {
  ProviderTestError,
  fetchProviderModels,
  normalizeProviderModel,
  resolveProvider,
  testProviderCompletion,
} from './provider-testing.mjs';
import {
  AgentExecutionError,
  TaskRunAPI,
  TaskReportAPI,
  TaskCancelAPI,
  TaskValidateAPI,
  TaskResultAPI,
} from './runtime-adapter.mjs';
import { createRunAgentSse } from './sse-adapter.mjs';
import {
  AgentCatalogError,
  listAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  copyAgent,
  seedAgentIfEmpty,
} from './agent-catalog.mjs';
import { getKnownSettings, setSetting, deleteSetting, validateSettingsBody } from './settings.mjs';
import {
  resolveMem0Config,
  checkMem0Status,
  getMem0Config,
  listAgentMemories,
  configureMem0,
  runMem0Test,
} from './mem0-proxy.mjs';
import {
  persistExecution,
  listExecutions,
  getExecutionById,
  deleteExecution,
  getAgentStats,
  parseSessionFile,
} from './execution-store.mjs';
import { createSseEventQueue } from './runs-events.mjs';
import { FeishuEventError, parseFeishuEventBody } from './feishu-events.mjs';
import { handleFeishuReceiveMessage } from './feishu-trigger-handler.mjs';

/**
 * Translate a thrown AgentCatalogError into a 400 JSON response. Non-catalog
 * errors are rethrown so Hono's default 500 handler (or the task-error
 * translation above) takes them. Collapses the 3× repeated try/catch blocks
 * that POST/PUT /agents and /agents/test would otherwise each spell out.
 */
function catalogErrorResponse(err) {
  if (err instanceof AgentCatalogError) {
    const status = err.code === 'workflow_reference' ? 409 : 400;
    return { body: { error: err.message, code: err.code }, status };
  }
  return null;
}

function providerErrorResponse(err) {
  if (err instanceof ProviderTestError) {
    return { body: { error: err.message, code: err.code }, status: err.status };
  }
  return null;
}

function validateProviderResponse(provider, requireModel) {
  try {
    resolveProvider(provider, { requireModel });
    return null;
  } catch (err) {
    return providerErrorResponse(err);
  }
}

/**
 * Translate a thrown error from the task layer into a {code, message} JSON
 * response (#56 decision 3).
 */
function taskErrorResponse(err, fallback) {
  if (err instanceof AgentExecutionError) {
    return { code: err.kind, message: err.message, detail: err.detail };
  }
  return { code: 'internal_error', message: err?.message ?? fallback };
}

function workflowHashFromSchema(schema) {
  const s = typeof schema === 'string' ? schema : JSON.stringify(schema);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return `wf_${(h >>> 0).toString(36)}`;
}

function providerFingerprint(provider) {
  return JSON.stringify({
    base_url: typeof provider?.base_url === 'string' ? provider.base_url.trim() : '',
    api_key: typeof provider?.api_key === 'string' ? provider.api_key.trim() : '',
    model: typeof provider?.model === 'string' ? provider.model.trim() : '',
  });
}

function providerListFingerprint(provider) {
  return JSON.stringify({
    base_url: typeof provider?.base_url === 'string' ? provider.base_url.trim() : '',
    api_key: typeof provider?.api_key === 'string' ? provider.api_key.trim() : '',
  });
}

export function enqueueSavedWorkflowRun({ db, enqueueRun, workflowId, schema, inputs }) {
  const wf = db.prepare('SELECT id, data FROM workflows WHERE id=?').get(workflowId);
  if (!wf) return null;

  const runID = nanoid(12);
  const workflowSchema =
    schema === undefined ? wf.data : typeof schema === 'string' ? schema : JSON.stringify(schema);
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, 'queued', datetime('now'))"
  ).run(runID, workflowId);
  if (typeof enqueueRun === 'function') {
    enqueueRun(workflowId, runID, { schema: workflowSchema, inputs });
  }
  return { runID, schema: workflowSchema };
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
 * @param {(c: object, handler: (stream: object) => Promise<void>) => Response} [deps.runEventsStreamSSE]
 *   Optional streamSSE implementation for Workflow Run event tests.
 * @param {(workflowId: string, runID: string, payload: {schema: string, inputs: object}) => void} [deps.enqueueRun]
 *   Phase 2 injects a placeholder; Phase 3 replaces it with the real
 *   per-workflow serial queue. Called when a saved-workflow run is enqueued.
 * @param {(runID: string) => boolean} [deps.cancelQueuedRun]
 *   Phase 3: cancel a queued run. Returns true if the run was queued and
 *   removed (DB row → terminated); false if the run was not queued (running
 *   / terminal / missing). The endpoint uses this to route queued cancels.
 * @param {(runID: string) => Promise<{success: boolean}>} [deps.cancelRunningRun]
 *   Phase 3: cancel a running run by runID. Looks up the taskID via the
 *   queue and calls TaskCancelAPI. Returns {success:true} if the cancel
 *   request was sent (best-effort — terminal capture is Phase 4).
 * @param {(workflowId: string, runID: string) => number} [deps.getRunQueuePosition]
 *   Phase 3: 1-based queue position for a queued run (0 if running/terminal/missing).
 *   Used by GET /api/runs/:runID to show "Queued, position N" in the Test Run panel.
 * @param {(runID: string) => object | null} [deps.getRunningReport]
 *   #179: the latest intermediate IReport for a running run, or null. Used by
 *   the SSE init frame to catch up a late subscriber on the current per-node
 *   state (which node is Processing). Null for queued/terminal/missing runs.
 * @param {object} [deps.eventBus] - Phase 5 SSE bus for run status broadcasts.
 *   Optional — if absent, the SSE endpoint returns 503 (disabled). Tests pass
 *   a fake bus to exercise the SSE endpoint without a real HTTP server.
 * @param {number} [deps.runEventsHeartbeatMs=25000] - heartbeat interval for
 *   Workflow Run event streams.
 * @param {object} [deps.feishuLongConnectionManager]
 *   Refreshes long-connection clients after workflow trigger config changes.
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
  runEventsStreamSSE = honoStreamSSE,
  enqueueRun,
  cancelQueuedRun,
  cancelRunningRun,
  getRunQueuePosition,
  getRunningReport,
  eventBus,
  runEventsHeartbeatMs = 25_000,
  providerClient = { fetchModels: fetchProviderModels, testCompletion: testProviderCompletion },
  feishuLongConnectionManager,
}) {
  const app = new Hono();

  async function refreshFeishuLongConnections() {
    try {
      await feishuLongConnectionManager?.refresh?.();
    } catch (err) {
      console.error('[feishu] failed to refresh long connections', err);
    }
  }

  // Provider tests run against unsaved drafts. Keep their short-lived proofs
  // in process memory so the save route can enforce the same test gate without
  // persisting credentials or adding columns to the Agent record.
  const providerTokens = new Map();
  const providerTokenTtlMs = 5 * 60 * 1000;

  function issueProviderToken(kind, { agentId, provider, models }) {
    const token = nanoid(32);
    providerTokens.set(token, {
      kind,
      agentId,
      fingerprint:
        kind === 'models' ? providerListFingerprint(provider) : providerFingerprint(provider),
      models,
      expiresAt: Date.now() + providerTokenTtlMs,
    });
    return token;
  }

  function readProviderToken(token, kind, agentId, provider) {
    const record = providerTokens.get(token);
    if (
      !record ||
      record.kind !== kind ||
      record.agentId !== agentId ||
      record.expiresAt <= Date.now()
    ) {
      if (record?.expiresAt <= Date.now()) providerTokens.delete(token);
      return null;
    }
    const fingerprint =
      kind === 'models' ? providerListFingerprint(provider) : providerFingerprint(provider);
    if (record.fingerprint !== fingerprint) return null;
    return record;
  }

  // --- SSE adapter (credential boundary preserved — see server/index.mjs) ---
  const runAgentSse = createRunAgentSse({
    runAgentExecution,
    createAgentSessionForAgent,
    agentDir,
    ...(streamSSE ? { streamSSE } : {}),
    onTerminal: ({ terminal, agentConfig, startedAt, endedAt, sessionFile }) => {
      // Only persist executions for real agents (have id), not /agents/test
      if (!agentConfig.id) return;
      const status =
        terminal.phase === 'succeeded'
          ? 'succeeded'
          : terminal.phase === 'cancelled'
          ? 'cancelled'
          : 'failed';
      persistExecution(db, {
        agentId: agentConfig.id,
        status,
        triggerType: 'standalone',
        sessionFile: sessionFile ?? null,
        startedAt,
        endedAt,
      });
    },
  });

  // --- Draft-run lock (minimal, draft-only) ---
  // #144 decision: the schema-hash 409 `workflow_busy` mutex is REMOVED for
  // saved workflows — the per-workflow serial queue (Phase 3) owns their
  // serialization. Draft runs (no workflowId, low stakes, ephemeral) keep a
  // minimal per-process schema-hash lock so two concurrent draft Test Runs of
  // the SAME unsaved schema don't clobber each other. Different schemas race
  // freely (intended — drafts are throwaway). No TTL sweep: drafts are
  // short-lived and the lock is released on terminal report/cancel.
  const draftLocks = new Map(); // wfHash → taskID

  // Release the draft lock for a given taskID. Called from /api/task/report
  // (on terminal status) and /api/task/cancel (on success). Saved-workflow
  // terminal capture is owned by Phase 4's onTerminal hook, NOT these routes.
  function releaseDraftLockByTaskID(taskID) {
    for (const [hash, tid] of draftLocks) {
      if (tid === taskID) {
        draftLocks.delete(hash);
        return;
      }
    }
  }

  // --- CORS (dev origin; harmless in prod where same-origin) ---
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (c.req.method === 'OPTIONS') return c.text('', 204);
    await next();
  });

  app.get('/health/live', (c) => c.json({ status: 'live' }));

  app.post('/api/feishu/events', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }

    let parsed;
    try {
      parsed = parseFeishuEventBody(body, {
        verificationToken: process.env.FEISHU_EVENT_VERIFICATION_TOKEN ?? '',
        encryptKey: process.env.FEISHU_EVENT_ENCRYPT_KEY ?? '',
      });
    } catch (err) {
      if (err instanceof FeishuEventError)
        return c.json({ error: err.code, message: err.message }, 400);
      throw err;
    }

    if (parsed.kind === 'challenge') {
      return c.json({ challenge: parsed.challenge });
    }

    const result = await handleFeishuReceiveMessage({
      db,
      payload: parsed.payload,
      enqueueSavedWorkflowRun: ({ workflowId, schema, inputs }) =>
        enqueueSavedWorkflowRun({ db, enqueueRun, workflowId, schema, inputs }),
    });
    if (result.statusCode) return c.json(result, result.statusCode);
    return c.json(result);
  });

  // --- Workflow CRUD ---
  app.get('/workflows', (c) => {
    const rows = db
      .prepare('SELECT id, name, created_at, updated_at FROM workflows ORDER BY created_at DESC')
      .all();
    return c.json(rows);
  });

  app.get('/workflows/:id', (c) => {
    const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({ ...row, data: JSON.parse(row.data) });
  });

  app.post('/workflows', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body || typeof body !== 'object' || !body.name)
      return c.json({ error: 'name is required' }, 400);
    const id = nanoid(10);
    db.prepare('INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)').run(
      id,
      body.name,
      JSON.stringify(body.data ?? {})
    );
    await refreshFeishuLongConnections();
    const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    return c.json({ ...row, data: JSON.parse(row.data) }, 201);
  });

  app.put('/workflows/:id', async (c) => {
    const id = c.req.param('id');
    const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    if (!existing) return c.json({ error: 'not found' }, 404);
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body || typeof body !== 'object') return c.json({ error: 'body must be an object' }, 400);
    const name = body.name ?? existing.name;
    const data = body.data !== undefined ? JSON.stringify(body.data) : existing.data;
    db.prepare(
      "UPDATE workflows SET name = ?, data = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(name, data, id);
    await refreshFeishuLongConnections();
    const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    return c.json({ ...row, data: JSON.parse(row.data) });
  });

  app.delete('/workflows/:id', async (c) => {
    const id = c.req.param('id');
    // Phase 6 (#158): refuse to delete a workflow that still has queued or
    // running runs. The user must cancel (or wait for) them first — no bulk
    // cancel from the delete path (map out-of-scope).
    const activeCount =
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id=? AND status IN ('queued','running')"
        )
        .get(id)?.n ?? 0;
    if (activeCount > 0) {
      return c.json({ error: 'workflow_has_active_runs', activeCount }, 409);
    }
    const result = db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    if (result.changes === 0) return c.json({ error: 'not found' }, 404);
    // Cascade (PRAGMA foreign_keys=ON from Phase 1 + ON DELETE CASCADE) has
    // already removed all workflow_runs rows. Notify any open SSE subscribers
    // so the History Modal / Delete button can close.
    if (eventBus) {
      try {
        eventBus.broadcast(id, { type: 'workflow_deleted', workflowId: id });
      } catch (err) {
        console.error('[app] workflow_deleted broadcast failed for', id, err);
      }
    }
    await refreshFeishuLongConnections();
    return c.json({ ok: true });
  });

  app.post('/workflows/:id/copy', async (c) => {
    const src = db.prepare('SELECT * FROM workflows WHERE id = ?').get(c.req.param('id'));
    if (!src) return c.json({ error: 'not found' }, 404);
    const id = nanoid(10);
    db.prepare('INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)').run(
      id,
      `${src.name} (copy)`,
      src.data
    );
    await refreshFeishuLongConnections();
    const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
    return c.json({ ...row, data: JSON.parse(row.data) }, 201);
  });

  // --- Agent copy ---
  app.post('/agents/:id/copy', (c) => {
    const copied = copyAgent(db, c.req.param('id'));
    if (!copied) return c.json({ error: 'not found' }, 404);
    return c.json(copied, 201);
  });

  // --- Agent CRUD ---
  app.get('/agents', (c) => c.json(listAgents(db)));

  // --- Provider configuration checks (unsaved draft) ---
  app.post('/agents/:id/provider/models', async (c) => {
    const agentId = c.req.param('id');
    if (!getAgentById(db, agentId)) return c.json({ error: 'not found' }, 404);
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const provider = body?.provider;
    const validation = validateProviderResponse(provider, false);
    if (validation) return c.json(validation.body, validation.status);
    try {
      const result = await providerClient.fetchModels(provider);
      const models = Array.isArray(result?.models)
        ? result.models.map(normalizeProviderModel).filter(Boolean)
        : [];
      if (models.length === 0) {
        return c.json({ error: 'Provider returned no models', code: 'provider_models_empty' }, 502);
      }
      const modelListToken = issueProviderToken('models', { agentId, provider, models });
      return c.json({ models, model_list_token: modelListToken });
    } catch (err) {
      const translated = providerErrorResponse(err);
      if (translated) return c.json(translated.body, translated.status);
      throw err;
    }
  });

  app.post('/agents/:id/provider/test', async (c) => {
    const agentId = c.req.param('id');
    if (!getAgentById(db, agentId)) return c.json({ error: 'not found' }, 404);
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const provider = body?.provider;
    const validation = validateProviderResponse(provider, true);
    if (validation) return c.json(validation.body, validation.status);
    const modelsToken = readProviderToken(body?.model_list_token, 'models', agentId, provider);
    if (!modelsToken) {
      return c.json(
        { error: 'A current provider model list is required', code: 'provider_models_required' },
        409
      );
    }
    try {
      const result = await providerClient.testCompletion(provider, { models: modelsToken.models });
      const testToken = issueProviderToken('test', {
        agentId,
        provider,
        models: modelsToken.models,
      });
      return c.json({ ...result, test_token: testToken });
    } catch (err) {
      const translated = providerErrorResponse(err);
      if (translated) return c.json(translated.body, translated.status);
      throw err;
    }
  });

  app.put('/agents/:id/provider', async (c) => {
    const agentId = c.req.param('id');
    if (!getAgentById(db, agentId)) return c.json({ error: 'not found' }, 404);
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const provider = body?.provider;
    const validation = validateProviderResponse(provider, true);
    if (validation) return c.json(validation.body, validation.status);
    const testToken = readProviderToken(body?.test_token, 'test', agentId, provider);
    if (!testToken) {
      return c.json(
        {
          error: 'Provider must pass its current model list and completion test before saving',
          code: 'provider_test_required',
        },
        409
      );
    }
    const agent = updateAgent(db, agentId, { config: { provider } });
    return c.json(agent);
  });

  // Static-named /agents/* routes MUST precede /agents/:id — Hono matches
  // in registration order, so /agents/export would otherwise be captured
  // by the :id parameter (id="export") and return 404.

  // --- Agent Export (bulk) ---
  app.get('/agents/export', (c) => {
    const includeSecrets = c.req.query('include_secrets') === 'true';
    const agents = listAgents(db);
    const exported = agents.map((a) => {
      const config = JSON.parse(a.config);
      if (!includeSecrets && config.provider) {
        // Keep $ENV_VAR references, blank out literal keys
        if (config.provider.api_key && !config.provider.api_key.startsWith('$')) {
          config.provider.api_key = null;
        }
      }
      return { name: a.name, runtime: a.runtime, tags: JSON.parse(a.tags), config };
    });
    c.header('Content-Disposition', 'attachment; filename=agents-export.json');
    return c.json(exported);
  });

  app.get('/agents/:id', (c) => {
    const agent = getAgentById(db, c.req.param('id'));
    if (!agent) return c.json({ error: 'not found' }, 404);
    return c.json(agent);
  });

  app.post('/agents', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body || typeof body !== 'object') return c.json({ error: 'body must be an object' }, 400);
    try {
      const agent = createAgent(db, {
        name: body.name,
        runtime: body.runtime,
        config: body.config,
        tags: body.tags,
      });
      return c.json(agent, 201);
    } catch (err) {
      const translated = catalogErrorResponse(err);
      if (translated) return c.json(translated.body, translated.status);
      throw err;
    }
  });

  app.put('/agents/:id', async (c) => {
    const { id } = c.req.param();
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body || typeof body !== 'object') return c.json({ error: 'body must be an object' }, 400);
    if (body.config && typeof body.config === 'object' && body.config.provider !== undefined) {
      return c.json(
        {
          error: 'Provider must pass its current model list and completion test before saving',
          code: 'provider_test_required',
        },
        409
      );
    }
    try {
      const agent = updateAgent(db, id, body);
      if (!agent) return c.json({ error: 'not found' }, 404);
      return c.json(agent);
    } catch (err) {
      const translated = catalogErrorResponse(err);
      if (translated) return c.json(translated.body, translated.status);
      throw err;
    }
  });

  app.delete('/agents/:id', (c) => {
    try {
      const ok = deleteAgent(db, c.req.param('id'));
      if (!ok) return c.json({ error: 'not found' }, 404);
      return c.json({ ok: true });
    } catch (err) {
      const translated = catalogErrorResponse(err);
      if (translated) return c.json(translated.body, translated.status);
      throw err;
    }
  });

  // --- Agent Run (SSE) ---
  app.post('/agents/:id/run', async (c) => {
    const agent = getAgentById(db, c.req.param('id'));
    if (!agent) return c.json({ error: 'agent not found' }, 404);
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body?.prompt) return c.json({ error: 'prompt is required' }, 400);
    return runAgentSse(c, agent, body.prompt);
  });

  // --- Agent Test (SSE) ---
  app.post('/agents/test', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const { config, prompt } = body ?? {};
    if (!config?.provider?.base_url || !config?.provider?.api_key || !config?.provider?.model) {
      return c.json(
        {
          error:
            'config.provider.base_url, config.provider.api_key, config.provider.model are required',
        },
        400
      );
    }
    const testAgent = { name: 'test', config };
    return runAgentSse(c, testAgent, prompt || 'Say hello in one sentence.');
  });

  // --- Agent Execution History ---
  app.get('/agents/:id/executions', (c) => {
    const agentId = c.req.param('id');
    const agent = getAgentById(db, agentId);
    if (!agent) return c.json({ error: 'agent not found' }, 404);
    const limit = Number(c.req.query('limit') ?? 50);
    const offset = Number(c.req.query('offset') ?? 0);
    const status = c.req.query('status') || null;
    return c.json(listExecutions(db, agentId, { limit, offset, status }));
  });

  app.get('/agents/:id/executions/:execId', (c) => {
    const exec = getExecutionById(db, c.req.param('execId'));
    if (!exec) return c.json({ error: 'not found' }, 404);
    // Enrich with pi session file detail if available
    const sessionDetail = parseSessionFile(exec.session_file);
    return c.json({ ...exec, sessionDetail });
  });

  app.delete('/agents/:id/executions/:execId', (c) => {
    const ok = deleteExecution(db, c.req.param('execId'));
    if (!ok) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  // --- Agent Stats ---
  app.get('/agents/:id/stats', (c) => {
    const agentId = c.req.param('id');
    const agent = getAgentById(db, agentId);
    if (!agent) return c.json({ error: 'agent not found' }, 404);
    return c.json(getAgentStats(db, agentId));
  });

  // --- Agent Export (single) ---
  app.get('/agents/:id/export', (c) => {
    const agent = getAgentById(db, c.req.param('id'));
    if (!agent) return c.json({ error: 'not found' }, 404);
    const includeSecrets = c.req.query('include_secrets') === 'true';
    const config = JSON.parse(agent.config);
    if (!includeSecrets && config.provider) {
      if (config.provider.api_key && !config.provider.api_key.startsWith('$')) {
        config.provider.api_key = null;
      }
    }
    const exported = {
      name: agent.name,
      runtime: agent.runtime,
      tags: JSON.parse(agent.tags),
      config,
    };
    c.header(
      'Content-Disposition',
      `attachment; filename=agent-${agent.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`
    );
    return c.json(exported);
  });

  // --- Agent Import (pre-check) ---
  app.post('/agents/import', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!Array.isArray(body)) return c.json({ error: 'body must be a JSON array' }, 400);
    const existing = listAgents(db);
    const existingNames = new Set(existing.map((a) => a.name));
    const conflicts = body.filter((item) => existingNames.has(item.name));
    return c.json({
      total: body.length,
      conflicts: conflicts.map((a) => a.name),
      importable: body.length - conflicts.length,
    });
  });

  // --- Agent Import (confirm) ---
  app.post('/agents/import/confirm', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const { agents: items, on_conflict = 'skip' } = body ?? {};
    if (!Array.isArray(items)) return c.json({ error: 'agents must be a JSON array' }, 400);
    const existing = listAgents(db);
    const existingByName = new Map(existing.map((a) => [a.name, a]));
    let created = 0,
      skipped = 0,
      overwritten = 0;
    for (const item of items) {
      const conflict = existingByName.get(item.name);
      if (conflict) {
        if (on_conflict === 'skip') {
          skipped++;
          continue;
        }
        if (on_conflict === 'overwrite') {
          // Strip null api_key from imported config — a null means "not provided"
          // (sanitized export), not "clear the key". Preserves existing credentials.
          const importConfig =
            typeof item.config === 'string' ? JSON.parse(item.config) : { ...item.config };
          if (importConfig.provider?.api_key === null) {
            const existingConfig =
              typeof conflict.config === 'string' ? JSON.parse(conflict.config) : conflict.config;
            importConfig.provider = {
              ...importConfig.provider,
              api_key: existingConfig?.provider?.api_key ?? '',
            };
          }
          updateAgent(db, conflict.id, { config: importConfig, tags: item.tags });
          overwritten++;
          continue;
        }
        // rename
        let suffix = 2;
        while (existingByName.has(`${item.name} ${suffix}`)) suffix++;
        item.name = `${item.name} ${suffix}`;
      }
      createAgent(db, {
        name: item.name,
        runtime: item.runtime,
        config: item.config,
        tags: item.tags,
      });
      existingByName.set(item.name, { name: item.name });
      created++;
    }
    return c.json({ created, skipped, overwritten });
  });

  // --- Phase 9 (#161): global settings (node timeout default, etc.) ---
  // GET /api/settings returns the known settings object (absent keys = null).
  // PUT /api/settings validates and upserts node_timeout_default_ms.
  app.get('/api/settings', (c) => c.json(getKnownSettings(db)));

  app.put('/api/settings', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    const result = validateSettingsBody(body);
    if (!result.ok) return c.json({ error: result.error }, 400);
    for (const [key, value] of Object.entries(result.value)) {
      if (value === null) {
        deleteSetting(db, key);
      } else {
        setSetting(db, key, value);
      }
    }
    return c.json(getKnownSettings(db));
  });

  // --- mem0 proxy (thin forwarding to the self-hosted mem0 server) ---
  // The browser never holds the mem0 API key; every mem0 call goes through
  // these routes, which read credentials from the settings table.
  // mem0 config is resolved lazily per-request (the settings table may not
  // exist in minimal test DBs, and settings can change between requests).

  // GET /api/mem0/status — connectivity + current LLM/embedding config.
  app.get('/api/mem0/status', async (c) => {
    const mem0 = resolveMem0Config(db);
    if (!mem0)
      return c.json(
        { ok: false, error: 'mem0 not configured (set mem0_host + mem0_api_key)' },
        400
      );
    try {
      const [status, config] = await Promise.all([
        checkMem0Status(mem0),
        getMem0Config(mem0).catch((e) => ({ ok: false, status: 0, body: { detail: e.message } })),
      ]);
      return c.json({ ok: status.ok, status: status, config: config });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 502);
    }
  });

  // GET /api/mem0/memories?agentId=xxx — list memories for one agent.
  app.get('/api/mem0/memories', async (c) => {
    const mem0 = resolveMem0Config(db);
    if (!mem0) return c.json({ ok: false, error: 'mem0 not configured' }, 400);
    const agentId = c.req.query('agentId') ?? c.req.query('agent_id');
    if (!agentId) return c.json({ ok: false, error: 'agentId is required' }, 400);
    try {
      const result = await listAgentMemories(mem0, agentId);
      return c.json({ ok: result.ok, status: result.status, ...result.body });
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 502);
    }
  });

  // POST /api/mem0/test — minimal end-to-end test (connect + extract + search + cleanup).
  app.post('/api/mem0/test', async (c) => {
    const mem0 = resolveMem0Config(db);
    if (!mem0) return c.json({ ok: false, error: 'mem0 not configured' }, 400);
    try {
      return c.json(await runMem0Test(mem0));
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 502);
    }
  });

  // POST /api/mem0/configure — push LLM/embedding config to the mem0 server.
  app.post('/api/mem0/configure', async (c) => {
    const mem0 = resolveMem0Config(db);
    if (!mem0) return c.json({ ok: false, error: 'mem0 not configured' }, 400);
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    try {
      const result = await configureMem0(mem0, {
        llmBaseUrl: body.llm_base_url ?? null,
        llmModel: body.llm_model ?? null,
        embedderModel: body.embedder_model ?? null,
        embeddingDims: body.embedding_dims ?? null,
      });
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, error: err.message }, 502);
    }
  });

  // --- FlowGram task endpoints ---
  app.post('/api/task/validate', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body?.schema) return c.json({ error: 'schema is required' }, 400);
    const schema = typeof body.schema === 'string' ? body.schema : JSON.stringify(body.schema);
    try {
      const result = await TaskValidateAPI({ schema, inputs: body.inputs ?? {} });
      return c.json(result);
    } catch (err) {
      return c.json(taskErrorResponse(err, 'validate failed'), 500);
    }
  });

  app.post('/api/task/run', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body?.schema) return c.json({ error: 'schema is required' }, 400);
    const schema = typeof body.schema === 'string' ? body.schema : JSON.stringify(body.schema);
    const inputs = body.inputs ?? {};

    // --- Saved-workflow path: enqueue (Phase 3 drives the queue) ---
    if (body.workflowId) {
      const result = enqueueSavedWorkflowRun({
        db,
        enqueueRun,
        workflowId: body.workflowId,
        schema,
        inputs,
      });
      if (!result) return c.json({ error: 'workflow not found', workflowId: body.workflowId }, 404);

      // Return the runID (NOT the runtime taskID — that's filled when the
      // queue dequeues). status='queued' signals the Test Run panel to show
      // the queued state (Phase 7 owns the full history UI).
      return c.json({ runID: result.runID, status: 'queued' });
    }

    // --- Draft path (no workflowId): immediate execution, minimal lock ---
    // Drafts are ephemeral / unsaved, so they bypass the queue and
    // workflow_runs entirely. A per-process schema-hash lock prevents two
    // concurrent draft Test Runs of the SAME unsaved schema from clobbering
    // each other (low stakes — drafts are throwaway). Different unsaved
    // schemas race freely.
    const wfHash = workflowHashFromSchema(schema);
    const existingDraftTaskID = draftLocks.get(wfHash);
    if (existingDraftTaskID) {
      return c.json(
        { code: 'workflow_busy', message: 'draft already running', taskID: existingDraftTaskID },
        409
      );
    }
    // Acquire the lock SYNCHRONOUSLY before the await, using a placeholder
    // taskID. Without this, two concurrent draft submits of the same schema
    // would both pass the check above (TOCTOU) and run in parallel — the
    // very race the lock exists to prevent. Patched to the real taskID once
    // TaskRunAPI resolves.
    const placeholderID = `pending_${nanoid(10)}`;
    draftLocks.set(wfHash, placeholderID);

    try {
      const result = await TaskRunAPI({ schema, inputs });
      draftLocks.set(wfHash, result.taskID);
      // Alias taskID as runID so the frontend's runID-based logic works for
      // both paths (saved-workflow uses runID=nanoid(12); draft uses
      // runID=taskID). status='running' since draft execution is synchronous.
      return c.json({ ...result, runID: result.taskID, status: 'running' });
    } catch (err) {
      releaseDraftLockByTaskID(placeholderID);
      return c.json(taskErrorResponse(err, 'task run failed'), 500);
    }
  });

  app.get('/api/task/report', async (c) => {
    const taskID = c.req.query('taskID');
    if (!taskID) return c.json({ error: 'taskID is required' }, 400);
    try {
      const report = await TaskReportAPI({ taskID });
      // Draft-lock release on terminal. Saved-workflow terminal capture is
      // owned by Phase 4 (queue's onTerminal hook) — NOT this route.
      // StatusData.terminated is the boolean "workflow done" flag.
      if (report?.workflowStatus?.terminated) {
        releaseDraftLockByTaskID(taskID);
      }
      return c.json(report);
    } catch (err) {
      return c.json(taskErrorResponse(err, 'report failed'), 500);
    }
  });

  app.get('/api/task/result', async (c) => {
    const taskID = c.req.query('taskID');
    if (!taskID) return c.json({ error: 'taskID is required' }, 400);
    try {
      const result = await TaskResultAPI({ taskID });
      return c.json(result ?? {});
    } catch (err) {
      return c.json(taskErrorResponse(err, 'result failed'), 500);
    }
  });

  app.put('/api/task/cancel', async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON' }, 400);
    }
    if (!body?.taskID) return c.json({ error: 'taskID is required' }, 400);
    try {
      const result = await TaskCancelAPI({ taskID: body.taskID });
      // Draft-lock release on cancel. Saved-workflow cancel goes through the
      // unified /api/runs/:runID/cancel endpoint (Phase 3), NOT this route.
      if (result?.success) {
        releaseDraftLockByTaskID(body.taskID);
      }
      return c.json(result);
    } catch (err) {
      return c.json(taskErrorResponse(err, 'cancel failed'), 500);
    }
  });

  // --- Phase 3: run status endpoint (now superseded by Phase 5's full-row
  // GET /api/runs/:runID below, which includes report + schema_snapshot +
  // queuePosition). Phase 5's handler serves both the Test Run panel (which
  // only reads status + queuePosition) and the History Modal detail view
  // (which reads report + schema_snapshot). ---

  // --- Phase 3: unified cancel endpoint for saved-workflow runs ---
  // PUT /api/runs/:runID/cancel routes by DB row status:
  //   - queued   → queue.cancelQueued (DB → terminated), no advance.
  //   - running  → cancelRunningRun (TaskCancelAPI via queue.getRunningTaskID).
  //   - terminal → 409 {error:'already_terminal'}.
  //   - missing  → 404.
  // This is the single cancel path for saved-workflow runs; the draft-path
  // PUT /api/task/cancel above stays for draft runs (which use taskID, not
  // runID, and bypass workflow_runs entirely).
  app.put('/api/runs/:runID/cancel', async (c) => {
    const runID = c.req.param('runID');
    const row = db.prepare('SELECT status, task_id FROM workflow_runs WHERE id=?').get(runID);
    if (!row) return c.json({ error: 'run not found', runID }, 404);

    if (row.status === 'queued') {
      const cancelled = typeof cancelQueuedRun === 'function' ? cancelQueuedRun(runID) : false;
      if (!cancelled) {
        // Race: the run transitioned to running between our SELECT and the
        // cancel call. Fall through to the running path — re-read the row.
        const fresh = db.prepare('SELECT status, task_id FROM workflow_runs WHERE id=?').get(runID);
        if (!fresh || fresh.status === 'queued') {
          return c.json({ error: 'cancel failed: run still queued after cancelQueuedRun' }, 500);
        }
        Object.assign(row, fresh);
      } else {
        return c.json({ ok: true, status: 'terminated' });
      }
    }

    if (row.status === 'running') {
      // task_id may be null for a brief window after dequeue (runTask hasn't
      // resolved yet). The cancelRunningRun hook looks up the taskID via the
      // queue's in-memory current entry, so it works even before task_id is
      // written to DB.
      if (typeof cancelRunningRun !== 'function') {
        return c.json({ error: 'cancel not wired (no cancelRunningRun hook)' }, 500);
      }
      try {
        const result = await cancelRunningRun(runID);
        // Terminal capture (Phase 4) writes the final DB state; here we just
        // confirm the cancel request was sent. The row stays "running" until
        // Phase 4's onTerminal hook classifies it (cancelled → terminated).
        // Do NOT invent a "cancelling" status — only the 5 canonical run
        // statuses are allowed (queued|running|succeeded|failed|terminated).
        return c.json({ ok: true, success: result?.success ?? false });
      } catch (err) {
        return c.json(taskErrorResponse(err, 'cancel running run failed'), 500);
      }
    }

    // succeeded | failed | terminated
    return c.json({ error: 'already_terminal', status: row.status }, 409);
  });

  // --- Phase 5: SSE run events endpoint (multi-tab broadcast) ---
  // A page-level connection can subscribe to several workflows through the
  // query string. The legacy per-workflow path delegates to the same stream
  // implementation so existing callers keep the same event semantics.
  function parseSseValues(url, key) {
    return new Set(
      url.searchParams
        .getAll(key)
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean)
    );
  }

  function streamRunEvents(c, requestedWorkflowIds, { notifyMissing = false } = {}) {
    if (!eventBus) return c.json({ error: 'events disabled' }, 503);

    const url = new URL(c.req.url);
    const workflowIds = [...new Set(requestedWorkflowIds)].filter(Boolean);
    if (workflowIds.length === 0) {
      return c.json({ error: 'workflowId is required' }, 400);
    }
    const existingWorkflowIds = workflowIds.filter((workflowId) =>
      db.prepare('SELECT id FROM workflows WHERE id=?').get(workflowId)
    );
    const missingWorkflowIds = workflowIds.filter(
      (workflowId) => !existingWorkflowIds.includes(workflowId)
    );
    if (existingWorkflowIds.length === 0 && !notifyMissing) {
      return c.json({ error: 'workflow not found' }, 404);
    }

    c.header('X-Accel-Buffering', 'no');
    const runIDs = parseSseValues(url, 'runID');
    const types = parseSseValues(url, 'type');

    return runEventsStreamSSE(c, async (stream) => {
      const queue = createSseEventQueue({
        maxPending: Math.max(64, existingWorkflowIds.length + 16),
      });
      let subscriptions = [];
      let heartbeat;
      let cleanedUp = false;
      const lastEventID = Number(c.req.header('Last-Event-ID'));
      let pageSequence = Number.isSafeInteger(lastEventID) && lastEventID >= 0 ? lastEventID : 0;
      const requestSignal = c.req.raw?.signal;
      const streamTarget = {
        push(frame) {
          if (frame?.kind === 'heartbeat') return queue.push(frame);
          const sequence = ++pageSequence;
          return queue.push({
            ...frame,
            id: String(sequence),
            sequence,
            payload: { ...frame.payload, sequence },
          });
        },
      };

      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (heartbeat) clearInterval(heartbeat);
        requestSignal?.removeEventListener('abort', cleanup);
        for (const subscription of subscriptions) subscription.unsubscribe();
        subscriptions = [];
        queue.close();
      };
      stream.onAbort(cleanup);
      requestSignal?.addEventListener('abort', cleanup, { once: true });

      if (stream.aborted || requestSignal?.aborted) {
        cleanup();
        return;
      }

      subscriptions = existingWorkflowIds.map((workflowId) =>
        eventBus.subscribe(workflowId, streamTarget, { runIDs, types })
      );

      try {
        await stream.write(':ping\n\n');
        for (const workflowId of missingWorkflowIds) {
          streamTarget.push({
            payload: { type: 'workflow_deleted', workflowId },
          });
        }
        for (let index = 0; index < existingWorkflowIds.length; index += 1) {
          const workflowId = existingWorkflowIds[index];
          const activeRows = db
            .prepare(
              "SELECT id, status FROM workflow_runs WHERE workflow_id=? AND status IN ('queued','running')"
            )
            .all(workflowId)
            .filter((row) => runIDs.size === 0 || runIDs.has(row.id));
          const activeRunIDs = activeRows.map((row) => row.id);
          const activeRuns = activeRows.map((row) => ({
            runID: row.id,
            status: row.status,
            report:
              row.status === 'running' && typeof getRunningReport === 'function'
                ? getRunningReport(row.id) ?? null
                : null,
          }));
          subscriptions[index].send({ type: 'init', workflowId, activeRunIDs, activeRuns });
        }

        heartbeat = setInterval(() => {
          queue.push({ kind: 'heartbeat' });
        }, runEventsHeartbeatMs);

        for await (const frame of queue) {
          if (stream.aborted) break;
          if (frame.kind === 'heartbeat') {
            await stream.write(':ping\n\n');
            continue;
          }
          await stream.writeSSE({
            id: frame.id,
            data: JSON.stringify(frame.payload),
          });
        }
      } catch (err) {
        if (!stream.aborted) {
          console.error('[runs/events] stream failed', err);
        }
      } finally {
        cleanup();
      }
    });
  }

  app.get('/api/runs/events', (c) => {
    const url = new URL(c.req.url);
    return streamRunEvents(c, parseSseValues(url, 'workflowId'), { notifyMissing: true });
  });

  app.get('/api/workflows/:id/runs/events', (c) => {
    return streamRunEvents(c, [c.req.param('id')]);
  });

  // --- Phase 5: REST history list (lightweight, no report/schema_snapshot) ---
  // GET /api/workflows/:id/runs returns the ordered list of runs for a
  // workflow. Excludes the heavy `report` and `schema_snapshot` columns so
  // the list payload stays small — the History Modal opens detail via
  // GET /api/runs/:runID which returns the full row.
  app.get('/api/workflows/:id/runs', (c) => {
    const workflowId = c.req.param('id');
    const rows = db
      .prepare(
        'SELECT id, status, task_id, queued_at, started_at, ended_at FROM workflow_runs WHERE workflow_id=? ORDER BY queued_at DESC'
      )
      .all(workflowId);
    return c.json(rows);
  });

  // --- Phase 5: single run detail (full row, parsed JSON) ---
  // GET /api/runs/:runID returns the full row including `report` and
  // `schema_snapshot` parsed as JSON objects (null if not yet terminal).
  app.get('/api/runs/:runID', (c) => {
    const runID = c.req.param('runID');
    const row = db
      .prepare(
        'SELECT id, workflow_id, status, task_id, report, schema_snapshot, queued_at, started_at, ended_at FROM workflow_runs WHERE id=?'
      )
      .get(runID);
    if (!row) return c.json({ error: 'run not found', runID }, 404);
    let queuePosition = 0;
    if (row.status === 'queued' && typeof getRunQueuePosition === 'function') {
      queuePosition = getRunQueuePosition(row.workflow_id, runID);
    }
    return c.json({
      ...row,
      report: row.report ? JSON.parse(row.report) : null,
      schema_snapshot: row.schema_snapshot ? JSON.parse(row.schema_snapshot) : null,
      queuePosition,
    });
  });

  // --- Phase 5: delete a single history run (terminal only) ---
  // DELETE /api/runs/:runID refuses to delete a queued/running run (409) so
  // in-flight runs can't be silently removed from history. Terminal runs are
  // deleted and the row is gone from the history list on next pull.
  app.delete('/api/runs/:runID', (c) => {
    const runID = c.req.param('runID');
    const row = db.prepare('SELECT status FROM workflow_runs WHERE id=?').get(runID);
    if (!row) return c.json({ error: 'run not found', runID }, 404);
    if (row.status === 'queued' || row.status === 'running') {
      return c.json({ error: 'run_not_terminal', status: row.status }, 409);
    }
    db.prepare('DELETE FROM workflow_runs WHERE id=?').run(runID);
    return c.json({ ok: true });
  });

  // --- Static serving + SPA fallback (prod only; dev mode uses rsbuild) ---
  if (staticEnabled) {
    const root = staticDir ?? './dist';

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
        headers.set('Cache-Control', cacheControl);
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
    app.use('/static/*', withCache(serveStatic({ root }), 'public, max-age=31536000, immutable'));

    // index.html — never cached (must pick up new deploys immediately).
    // `path: "index.html"` ignores the request URL and serves that file
    // fixed (serve-static.mjs:77), which is exactly SPA fallback semantics.
    // @hono/node-server@2.0.10 has no `fallback` option, so `path` is the
    // official SPA fallback idiom (T2 #118 decision).
    const noCacheHtml = withCache(serveStatic({ root, path: 'index.html' }), 'no-cache');
    app.get('/', noCacheHtml);
    app.get('/index.html', noCacheHtml);

    // favicon.ico — short cache (may change between deploys).
    app.get(
      '/favicon.ico',
      withCache(serveStatic({ root, path: 'favicon.ico' }), 'public, max-age=3600')
    );

    // SPA fallback — unknown GET paths return index.html so client-side
    // routing works. Only matches GET; POST/PUT/DELETE to unknown paths
    // fall through to Hono's 404 (T2 #118 — write APIs not silently
    // swallowed by index.html).
    app.get('*', noCacheHtml);
  }

  return app;
}
