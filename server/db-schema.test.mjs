import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { ensureSchema, markInflightRunsInterrupted } from './db-schema.mjs';

/**
 * Phase 1 (#153): workflow_runs + settings DB schema + restart-interrupt sweep.
 *
 * Pins #141 (table structure), #147 (schema_snapshot column), #145
 * (restart-interrupt). The schema setup + sweep live in a pure module
 * (db-schema.mjs) so they can be tested without spawning a real HTTP server —
 * server/index.mjs calls the same functions on startup.
 */
function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-schema-'));
  const db = new Database(join(dir, 'workflow.db'));
  db.pragma('journal_mode = WAL');
  // workflows table must exist first (FK target) — ensureSchema creates it.
  return db;
}

function columns(db, table) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

test('ensureSchema creates workflow_runs with all 9 columns incl. schema_snapshot', () => {
  const db = makeDb();
  ensureSchema(db);
  const cols = columns(db, 'workflow_runs');
  assert.deepEqual(
    cols.sort(),
    [
      'ended_at',
      'id',
      'queued_at',
      'report',
      'schema_snapshot',
      'started_at',
      'status',
      'task_id',
      'workflow_id',
    ].sort(),
    `workflow_runs columns mismatch: ${cols.join(', ')}`
  );
});

test('workflow_runs.task_id is UNIQUE (allows NULL, prevents dup non-null)', () => {
  const db = makeDb();
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', '{}')").run();
  // Two rows with NULL task_id must coexist (queued runs have no task_id yet).
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, 'queued', datetime('now'))"
  ).run('run_a', 'wf_1');
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, 'queued', datetime('now'))"
  ).run('run_b', 'wf_1');
  // Duplicate non-null task_id must reject.
  db.prepare('UPDATE workflow_runs SET task_id=? WHERE id=?').run('task_1', 'run_a');
  assert.throws(
    () => db.prepare('UPDATE workflow_runs SET task_id=? WHERE id=?').run('task_1', 'run_b'),
    /UNIQUE constraint failed: workflow_runs\.task_id/
  );
});

test('ensureSchema creates settings table (key-value)', () => {
  const db = makeDb();
  ensureSchema(db);
  const cols = columns(db, 'settings');
  assert.deepEqual(cols.sort(), ['key', 'value'].sort());
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('node_timeout_default_ms', '600000')"
  ).run();
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get('node_timeout_default_ms');
  assert.equal(row.value, '600000');
});

test('ensureSchema creates feishu_event_dedup table', () => {
  const db = makeDb();
  ensureSchema(db);
  const cols = columns(db, 'feishu_event_dedup');
  assert.deepEqual(cols.sort(), ['created_at', 'message_id', 'run_id'].sort());
});

test('ensureSchema creates idx_workflow_runs_wf_queued index', () => {
  const db = makeDb();
  ensureSchema(db);
  const idxs = db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='workflow_runs'")
    .all()
    .map((r) => r.name);
  assert.ok(
    idxs.includes('idx_workflow_runs_wf_queued'),
    `expected idx_workflow_runs_wf_queued, got: ${idxs.join(', ')}`
  );
});

test('ensureSchema enables foreign_keys (ON DELETE CASCADE from workflows)', () => {
  const db = makeDb();
  ensureSchema(db);
  // foreign_keys pragma must be ON.
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'foreign_keys pragma must be ON');
  // Seed a workflow + a run, then delete the workflow — run must cascade.
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', '{}')").run();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_1', 'wf_1', 'queued', datetime('now'))"
  ).run();
  db.prepare('DELETE FROM workflows WHERE id=?').run('wf_1');
  const row = db.prepare('SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id=?').get('wf_1');
  assert.equal(row.n, 0, 'workflow_runs row must cascade-delete with its workflow');
});

test('ensureSchema is idempotent (safe to call twice)', () => {
  const db = makeDb();
  ensureSchema(db);
  assert.doesNotThrow(() => ensureSchema(db));
});

test('markInflightRunsInterrupted sets queued/running rows to terminated with report.reason', () => {
  const db = makeDb();
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', '{}')").run();
  const ins = db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, 'wf_1', ?, datetime('now'))"
  );
  ins.run('run_queued', 'queued');
  ins.run('run_running', 'running');
  ins.run('run_success', 'succeeded');
  ins.run('run_failed', 'failed');
  ins.run('run_term', 'terminated');

  const swept = markInflightRunsInterrupted(db);

  assert.equal(swept, 2, 'only queued + running rows are swept');
  const rows = db
    .prepare('SELECT id, status, ended_at, report FROM workflow_runs ORDER BY id')
    .all();
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.run_queued.status, 'terminated');
  assert.equal(byId.run_running.status, 'terminated');
  assert.ok(byId.run_queued.ended_at, 'queued sweep must set ended_at');
  assert.ok(byId.run_running.ended_at, 'running sweep must set ended_at');
  assert.deepEqual(
    JSON.parse(byId.run_queued.report),
    { reason: 'server_restart_interrupt' },
    'queued sweep report.reason must be server_restart_interrupt'
  );
  assert.deepEqual(
    JSON.parse(byId.run_running.report),
    { reason: 'server_restart_interrupt' },
    'running sweep report.reason must be server_restart_interrupt'
  );
  // Terminal rows untouched.
  assert.equal(byId.run_success.status, 'succeeded');
  assert.equal(byId.run_failed.status, 'failed');
  assert.equal(byId.run_term.status, 'terminated');
  assert.equal(byId.run_success.report, null);
});

test('markInflightRunsInterrupted preserves existing report fields when patching reason', () => {
  const db = makeDb();
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', '{}')").run();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at, report) VALUES ('run_1', 'wf_1', 'running', datetime('now'), ?)"
  ).run(JSON.stringify({ nodeReports: { n1: { status: 'success' } } }));

  markInflightRunsInterrupted(db);

  const row = db.prepare('SELECT report FROM workflow_runs WHERE id=?').get('run_1');
  const report = JSON.parse(row.report);
  assert.equal(report.reason, 'server_restart_interrupt');
  assert.equal(report.nodeReports.n1.status, 'success', 'existing report fields preserved');
});

test('markInflightRunsInterrupted returns 0 when no in-flight rows exist', () => {
  const db = makeDb();
  ensureSchema(db);
  assert.equal(markInflightRunsInterrupted(db), 0);
});
