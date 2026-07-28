import { serve, getRequestListener } from "@hono/node-server";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  initRuntime,
  createAgentSessionForAgent,
} from "./runtime-adapter.mjs";
import { runAgentExecution } from "./agent-execution.mjs";
import { seedAgentIfEmpty } from "./agent-catalog.mjs";
import { createApp } from "./app.mjs";

// --- Config ---
// PORT (cloud-native standard) replaces SERVER_PORT. The legacy name is
// accepted with a deprecation warning so existing .env / docker-compose
// setups keep working until they migrate. Default diverges by mode:
//   - production → 4000
//   - development → 4001
// E2E overrides via env (see e2e/global-setup.ts → PORT=4099).
const PORT = Number(
  process.env.PORT ??
    (process.env.SERVER_PORT
      ? (console.warn("[deprecated] SERVER_PORT is replaced by PORT; use PORT instead."),
        process.env.SERVER_PORT)
      : process.env.NODE_ENV === "production" ? 4000 : 4001)
);
// WORKFLOW_DATA_DIR overrides the default data dir — used by E2E tests to
// isolate SQLite state and by Docker to mount a volume. Defaults diverge by
// mode so dev experimentation never corrupts prod data:
//   - production → ~/.config/workflow/
//   - development → ~/.config/workflow-dev/
const DATA_DIR = process.env.WORKFLOW_DATA_DIR
  ? resolve(process.env.WORKFLOW_DATA_DIR)
  : join(homedir(), ".config", process.env.NODE_ENV === "production" ? "workflow" : "workflow-dev");
const DB_PATH = join(DATA_DIR, "workflow.db");
const AGENT_DIR = join(DATA_DIR, "agents");

// --- Static serving config (prod only; dev mode uses rsbuild middlewareMode) ---
// STATIC_DIR lets Docker / custom deployments point at a non-default dist path.
// Defaults to ./dist relative to cwd (where `pnpm build` emits).
const STATIC_DIR = process.env.STATIC_DIR
  ? resolve(process.env.STATIC_DIR)
  : resolve(process.cwd(), "dist");
const IS_PROD = process.env.NODE_ENV === "production";
const STATIC_ENABLED = IS_PROD;

// --- SQLite init ---
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(AGENT_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Migration (#129): drop legacy agents table that used provider_api_key_env
// (env-var name) column. New schema stores the key value directly in
// provider_api_key. Detect by checking for the old column name; only drop if
// it exists, so fresh installs (no agents table yet) are unaffected.
const legacyCols = db.prepare("PRAGMA table_info(agents)").all();
if (legacyCols.some((c) => c.name === "provider_api_key_env")) {
  db.exec("DROP TABLE agents");
  console.log("  dropped legacy agents table (provider_api_key_env → provider_api_key)");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_base_url TEXT NOT NULL,
    provider_api_key TEXT NOT NULL,
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

// --- Seed fake-provider agent if empty ---
const seeded = seedAgentIfEmpty(db, {
  id: "fake-default",
  name: "Fake Provider",
  provider_base_url: "http://localhost:4010/v1",
  provider_api_key: "fake-provider-local",
  model: "fake-model",
  system_prompt: "You are a helpful assistant.",
  temperature: 0.7,
});
if (seeded) console.log("  seeded fake-provider agent");

// --- Init runtime (register AgentExecutor to replace built-in LLMExecutor) ---
initRuntime(db, AGENT_DIR);

// --- Build the Hono app (shared factory — see server/app.mjs) ---
// Credential: agent rows store provider_api_key directly (#129); createApp
// no longer needs process.env for credential resolution.
// staticEnabled=false in dev because rsbuild serves the SPA bundle via its
// own middleware (see dev-mode branch below). Prod enables serveStatic.
const app = createApp({
  db,
  agentDir: AGENT_DIR,
  staticEnabled: STATIC_ENABLED,
  staticDir: STATIC_DIR,
  runAgentExecution,
  createAgentSessionForAgent,
});

// --- Start ---
// Dev mode: mount Hono (API prefix whitelist) in front of rsbuild's dev
// middlewares on a single Node http.Server. HMR works via connectWebSocket.
// Prod mode: @hono/node-server `serve()` drives app.fetch directly; the SPA
// is served via serveStatic (see server/app.mjs).
let server;
function shutdown() {
  console.log("shutting down...");
  db.close();
  server?.close();
  process.exit(0);
}

if (IS_PROD) {
  server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`workflow agent server listening on http://localhost:${info.port}`);
    console.log(`  mode: production`);
    console.log(`  data: ${DATA_DIR}`);
    console.log(`  db: ${DB_PATH}`);
    console.log(`  static: ${STATIC_DIR}`);
  });
} else {
  // Dev: rsbuild middlewareMode + Hono on the same port. Dynamic import keeps
  // rsbuild (and its rspack worker pipeline) out of the prod module graph.
  // loadConfig() reads rsbuild.config.ts (plugins, alias, html tags, etc.) so
  // we don't have to duplicate that config here — we just override
  // server.middlewareMode on top.
  const { createRsbuild, loadConfig } = await import("@rsbuild/core");
  const loaded = await loadConfig();
  const rsbuild = await createRsbuild({
    config: {
      ...loaded.content,
      server: { ...loaded.content.server, middlewareMode: true },
    },
  });
  const rsbuildServer = await rsbuild.createDevServer();

  // Build a connect-style middleware stack: Hono (API prefix whitelist) FIRST,
  // then rsbuild's dev middlewares (SPA, HMR, /static/*). The Hono gate must
  // run before rsbuild's catch-all SPA fallback, otherwise /agents etc. would
  // return index.html.
  //
  // We can't use rsbuildServer.middlewares.use() for the Hono gate because
  // that appends AFTER rsbuild's own middlewares (including the SPA fallback).
  // Instead, wrap both in our own connect stack with Hono first.
  const honoListener = getRequestListener(app.fetch);
  const API_PREFIXES = ["/health", "/agents", "/workflows", "/api/task"];
  const apiGate = (req, res, next) => {
    const path = (req.url ?? "").split("?")[0];
    if (API_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))) {
      return honoListener(req, res);
    }
    next();
  };

  // node:http.createServer accepts a connect-style listener (req, res, next).
  // rsbuildServer.middlewares is a Connect instance with .handle() bound.
  server = createServer((req, res) => {
    apiGate(req, res, (err) => {
      if (err) return rsbuildServer.middlewares.handle(req, res, () => {
        res.statusCode = 500;
        res.end(String(err));
      });
      rsbuildServer.middlewares.handle(req, res);
    });
  });
  rsbuildServer.connectWebSocket({ server });
  await new Promise((resolve) => server.listen(PORT, resolve));
  await rsbuildServer.afterListen();

  console.log(`workflow agent server listening on http://localhost:${PORT}`);
  console.log(`  mode: development (rsbuild middlewareMode + Hono)`);
  console.log(`  data: ${DATA_DIR}`);
  console.log(`  db: ${DB_PATH}`);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
