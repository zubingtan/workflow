import { serve } from "@hono/node-server";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
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
const PORT = Number(process.env.SERVER_PORT ?? 4001);
// WORKFLOW_DATA_DIR overrides the default ~/.config/workflow/ data dir —
// used by E2E tests to isolate SQLite state. Defaults to the canonical path.
const DATA_DIR = process.env.WORKFLOW_DATA_DIR
  ? resolve(process.env.WORKFLOW_DATA_DIR)
  : join(homedir(), ".config", "workflow");
const DB_PATH = join(DATA_DIR, "workflow.db");
const AGENT_DIR = join(DATA_DIR, "agents");

// --- Static serving config (prod only; dev mode uses rsbuild middlewareMode) ---
// STATIC_DIR lets Docker / custom deployments point at a non-default dist path.
// Defaults to ./dist relative to cwd (where `pnpm build:prod` emits).
const STATIC_DIR = process.env.STATIC_DIR
  ? resolve(process.env.STATIC_DIR)
  : resolve(process.cwd(), "dist");
const STATIC_ENABLED = process.env.NODE_ENV === "production";

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
const app = createApp({
  db,
  agentDir: AGENT_DIR,
  staticEnabled: STATIC_ENABLED,
  staticDir: STATIC_DIR,
  runAgentExecution,
  createAgentSessionForAgent,
});

// --- Start ---
const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`workflow agent server listening on http://localhost:${info.port}`);
  console.log(`  data: ${DATA_DIR}`);
  console.log(`  db: ${DB_PATH}`);
  if (STATIC_ENABLED) console.log(`  static: ${STATIC_DIR}`);
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
