/**
 * Phase 1 (#153): DB schema + restart-interrupt sweep.
 *
 * Pure module (no serve(), no process.exit) so server/index.mjs can call these
 * on startup AND host-side tests can drive them with a temp better-sqlite3 DB
 * without spawning a real HTTP server. Keeps #145's restart sweep — which must
 * run synchronously before app.listen — out of the untestable server-lifecycle
 * glue.
 *
 * Decisions pinned:
 *   - #141: workflow_runs structure (5-status enum, runID nanoid(12) PK, task_id
 *     UNIQUE nullable, three timestamp fields, report JSON column).
 *   - #147: schema_snapshot JSON column added to workflow_runs (terminal-time
 *     workflow schema, used by the readonly history viewer in Phase 8).
 *   - #145: restart-interrupt sweep marks in-flight (queued/running) rows
 *     terminated with report.reason='server_restart_interrupt' — NOT a new
 *     `interrupted` status (cancelled + interrupted merged per #141).
 *   - #149: PRAGMA foreign_keys=ON + ON DELETE CASCADE so deleting a workflow
 *     removes its runs (delete-workflow active-run check is Phase 6).
 */

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    runtime TEXT NOT NULL DEFAULT 'pi-coding-agent',
    config TEXT NOT NULL DEFAULT '{}',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS agent_executions (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    status TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    workflow_run_id TEXT,
    session_file TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_agent_executions_agent
    ON agent_executions(agent_id, started_at DESC);

  CREATE INDEX IF NOT EXISTS idx_agent_executions_run
    ON agent_executions(workflow_run_id);

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL,
    task_id TEXT UNIQUE,
    report TEXT,
    schema_snapshot TEXT,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_runs_wf_queued
    ON workflow_runs(workflow_id, queued_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS feishu_event_dedup (
    message_id TEXT PRIMARY KEY,
    run_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL
  );
`;

/**
 * Create all tables + indices if missing, and enable FK cascade.
 * Idempotent — safe to call on every startup.
 */
export function ensureSchema(db) {
  db.pragma('foreign_keys = ON');
  migrateAgentsTableIfNeeded(db);
  db.exec(SCHEMA_SQL);
}

/**
 * Destructive one-time migration: old flat-column agents table → new config
 * JSON schema. Detects the old structure by checking for `provider_base_url`
 * column. Irreversible.
 */
function migrateAgentsTableIfNeeded(db) {
  const cols = db.prepare('PRAGMA table_info(agents)').all();
  if (!cols.length) return; // table doesn't exist yet — schema SQL will create it
  const hasOldCol = cols.some((c) => c.name === 'provider_base_url');
  if (!hasOldCol) return; // already migrated

  const rows = db.prepare('SELECT * FROM agents').all();
  db.exec(`
    CREATE TABLE agents_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'pi-coding-agent',
      config TEXT NOT NULL DEFAULT '{}',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const insert = db.prepare(
    'INSERT INTO agents_new (id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  );
  for (const row of rows) {
    const config = JSON.stringify({
      provider: {
        base_url: row.provider_base_url,
        api_key: row.provider_api_key,
        model: row.model,
      },
      system_prompt: row.system_prompt || '',
      session_options: {},
      pi_settings: { defaultProjectTrust: 'always' },
    });
    insert.run(row.id, row.name, config, row.created_at, row.updated_at);
  }
  db.exec(`
    DROP TABLE agents;
    ALTER TABLE agents_new RENAME TO agents;
  `);
}

/**
 * #145 restart-interrupt sweep: mark every in-flight (queued/running) run as
 * `terminated` with `report.reason='server_restart_interrupt'`. Called
 * synchronously on server startup, before app.listen, so users never see a
 * stale queued/running row after a crash/restart.
 *
 * Uses SQLite's `json_set(coalesce(report,'{}'), '$.reason', …)` so the whole
 * update is ONE atomic statement (no SELECT → JS-parse → UPDATE loop that a
 * mid-loop crash could leave partially applied). Existing report JSON fields
 * are preserved — `json_set` only sets/overwrites the `reason` key.
 *
 * Returns the number of rows swept (for startup logging).
 */
export function markInflightRunsInterrupted(db) {
  const info = db
    .prepare(
      `UPDATE workflow_runs
       SET status='terminated',
           ended_at=datetime('now'),
           report=json_set(coalesce(report,'{}'), '$.reason', 'server_restart_interrupt')
     WHERE status IN ('queued','running')`
    )
    .run();
  return info.changes;
}
