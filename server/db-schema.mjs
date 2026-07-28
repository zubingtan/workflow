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
    provider_base_url TEXT NOT NULL,
    provider_api_key TEXT NOT NULL,
    model TEXT NOT NULL,
    system_prompt TEXT DEFAULT '',
    temperature REAL DEFAULT 0.7,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

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
`;

/**
 * Create all tables + indices if missing, and enable FK cascade.
 * Idempotent — safe to call on every startup.
 */
export function ensureSchema(db) {
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
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
  const info = db.prepare(
    `UPDATE workflow_runs
       SET status='terminated',
           ended_at=datetime('now'),
           report=json_set(coalesce(report,'{}'), '$.reason', 'server_restart_interrupt')
     WHERE status IN ('queued','running')`
  ).run();
  return info.changes;
}
