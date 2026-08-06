import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { ensureSchema } from './db-schema.mjs';
import { createRunQueue } from './queue.mjs';
import { createCapturingOnTerminal } from './queue-adapter.mjs';

/**
 * Phase 4 (#156): terminal TaskReport capture path into workflow_runs.
 *
 * Pins #145 (terminal capture half — restart-interrupt half done in Phase 1):
 *   - onTerminal writes status + report (JSON TaskReport) + schema_snapshot
 *     (JSON workflow data) + ended_at in ONE UPDATE.
 *   - Idempotency: WHERE status NOT IN ('succeeded','failed','terminated')
 *     prevents double-writes from clobbering a terminal row.
 *   - Write failures are swallowed (try/catch) — do NOT crash the queue.
 *
 * The queue calls onTerminal(runID, result) where result includes taskID
 * (Phase 4 added taskID to the result so onTerminal can fetch the
 * TaskReport). The adapter's onTerminal does the actual DB write; here we
 * inject a fake onTerminal that mimics the adapter's behavior to test the
 * queue's contract (taskID present in result) AND inject a real adapter-like
 * onTerminal to test the DB write.
 */

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-phase4-'));
  const db = new Database(join(dir, 'workflow.db'));
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', ?)").run(
    JSON.stringify({ nodes: [{ id: 'n1', type: 'llm' }], edges: [] })
  );
  return { db, dir };
}

function seedRun(db, runID, workflowId = 'wf_1', status = 'queued') {
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, ?, datetime('now'))"
  ).run(runID, workflowId, status);
}

/**
 * A fake runTask that returns {taskID, done} synchronously. `done` resolves
 * immediately with the provided terminalResult unless `block(runID)` was
 * called before enqueue.
 */
function makeFakeRunTask(terminalResult = { status: 'success' }) {
  const calls = [];
  let counter = 0;
  const resolvers = new Map();
  const shouldBlock = new Set();
  const runTask = (workflowId, runID, payload) => {
    const taskID = `task_${++counter}`;
    calls.push({ workflowId, runID, payload, taskID });
    const done = shouldBlock.has(runID)
      ? new Promise((res) => resolvers.set(runID, res))
      : Promise.resolve(terminalResult);
    return { taskID, done };
  };
  return {
    runTask,
    calls,
    block(runID) {
      shouldBlock.add(runID);
      return (result) => {
        const res = resolvers.get(runID);
        if (res) {
          resolvers.delete(runID);
          res(result);
        }
      };
    },
  };
}

function makeFakeCancelTask() {
  const cancelled = [];
  const cancelTask = async ({ taskID }) => {
    cancelled.push(taskID);
    return { success: true };
  };
  return { cancelTask, cancelled };
}

// --- onTerminal: use the real adapter's createCapturingOnTerminal ---
// Phase 4 extracts the capture logic into createCapturingOnTerminal(db, fetchTaskReport?)
// so tests inject a fake fetchTaskReport and exercise the EXACT same SQL + merge
// logic as prod (no duplicated helper).

// --- Tests ---

test('queue passes taskID to onTerminal on normal completion (Phase 4 contract)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const terminals = [];
  const fake = makeFakeRunTask({ status: 'success' });
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: (runID, result) => terminals.push({ runID, result }),
  });

  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(terminals.length, 1, 'onTerminal called once');
  assert.equal(terminals[0].runID, 'run_1');
  assert.equal(terminals[0].result.status, 'success');
  assert.ok(terminals[0].result.taskID, 'taskID present in result (Phase 4 contract)');
  assert.equal(terminals[0].result.taskID, fake.calls[0].taskID);
});

test('queue passes taskID to onTerminal on wall-clock zombie', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const terminals = [];
  let now = 1000;
  // runTask whose done never resolves — zombie. taskID returned synchronously.
  const runTask = () => ({
    taskID: 'task_zombie',
    done: new Promise(() => {}),
  });
  const queue = createRunQueue({
    db,
    runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: (runID, result) => terminals.push({ runID, result }),
    wallClockMs: 30 * 60 * 1000,
    now: () => now,
    sweepIntervalMs: 10,
  });
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 20));
  now += 31 * 60 * 1000;
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(terminals.length, 1, 'onTerminal called for zombie');
  assert.equal(terminals[0].result.status, 'failed');
  assert.equal(terminals[0].result.reason, 'wall_clock_zombie');
  assert.ok(terminals[0].result.taskID, 'taskID present in zombie result (Phase 4 contract)');
  assert.equal(terminals[0].result.taskID, 'task_zombie');
  queue.dispose();
});

test('queue passes taskID to onTerminal on done rejection', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const terminals = [];
  const runTask = () => ({
    taskID: 'task_1',
    done: Promise.reject(new Error('boom')),
  });
  const queue = createRunQueue({
    db,
    runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: (runID, result) => terminals.push({ runID, result }),
  });
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].result.status, 'failed');
  assert.match(terminals[0].result.reason ?? '', /boom/);
  assert.ok(terminals[0].result.taskID, 'taskID present even on rejection (Phase 4 contract)');
  assert.equal(terminals[0].result.taskID, 'task_1');
});

test('capturing onTerminal writes status + report + schema_snapshot + ended_at for success', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const fakeReport = {
    workflowStatus: { success: true },
    inputs: { prompt: 'hello' },
    outputs: { result: 'world' },
    reports: {},
  };
  // Use the real adapter-like onTerminal with a fake TaskReport fetcher.
  const onTerminal = createCapturingOnTerminal(db, async (taskID) =>
    taskID === 'task_1' ? fakeReport : null
  );
  const queue = createRunQueue({
    db,
    // The real adapter's pollUntilTerminal calls classifyTerminal which maps
    // success→succeeded. Here we simulate that by resolving done with the
    // already-classified result.
    runTask: () => ({ taskID: 'task_1', done: Promise.resolve({ status: 'succeeded' }) }),
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal,
  });
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 20));

  const row = db
    .prepare('SELECT status, report, schema_snapshot, ended_at FROM workflow_runs WHERE id=?')
    .get('run_1');
  assert.equal(row.status, 'succeeded');
  assert.ok(row.report, 'report JSON written');
  const parsed = JSON.parse(row.report);
  assert.deepEqual(parsed.workflowStatus, { success: true });
  assert.deepEqual(parsed.outputs, { result: 'world' });
  assert.ok(row.ended_at, 'ended_at set');
  // schema_snapshot: the workflow data at terminal time (for Phase 8 readonly viewer).
  assert.ok(row.schema_snapshot, 'schema_snapshot written');
  const schemaParsed = JSON.parse(row.schema_snapshot);
  assert.deepEqual(schemaParsed.nodes, [{ id: 'n1', type: 'llm' }]);
});

test('capturing onTerminal writes report.reason for wall_clock_zombie', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  let now = 1000;
  const onTerminal = createCapturingOnTerminal(db, async () => null);
  const queue = createRunQueue({
    db,
    runTask: () => ({ taskID: 'task_z', done: new Promise(() => {}) }),
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal,
    wallClockMs: 30 * 60 * 1000,
    now: () => now,
    sweepIntervalMs: 10,
  });
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 20));
  now += 31 * 60 * 1000;
  await new Promise((r) => setTimeout(r, 30));

  const row = db.prepare('SELECT status, report FROM workflow_runs WHERE id=?').get('run_1');
  assert.equal(row.status, 'failed');
  assert.ok(row.report, 'report JSON written even for zombie');
  const parsed = JSON.parse(row.report);
  assert.equal(parsed.reason, 'wall_clock_zombie', 'reason captured in report');
  queue.dispose();
});

test('zombie terminal report timeout does not block the next queued run', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  seedRun(db, 'run_2');
  const fake = makeFakeRunTask();
  fake.block('run_2');
  const onTerminal = createCapturingOnTerminal(db, () => new Promise(() => {}), undefined, {
    reportTimeoutMs: 5,
  });
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal,
  });

  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  queue.enqueue('wf_1', 'run_2', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 25));

  const row = db.prepare('SELECT status FROM workflow_runs WHERE id=?').get('run_2');
  assert.equal(row.status, 'running');
  queue.dispose();
});

test('capturing onTerminal writes report.reason for run_error (rejection)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const onTerminal = createCapturingOnTerminal(db, async () => null);
  const queue = createRunQueue({
    db,
    runTask: () => ({ taskID: 'task_1', done: Promise.reject(new Error('provider_down')) }),
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal,
  });
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 20));

  const row = db.prepare('SELECT status, report FROM workflow_runs WHERE id=?').get('run_1');
  assert.equal(row.status, 'failed');
  const parsed = JSON.parse(row.report);
  assert.match(parsed.reason, /provider_down/);
});

test('double onTerminal call does not clobber a terminal row (idempotency)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const onTerminal = createCapturingOnTerminal(db, async () => ({
    workflowStatus: { success: true },
  }));
  // First call — writes succeeded + report. (In prod, result.status comes from
  // classifyTerminal which maps success→succeeded.)
  await onTerminal('run_1', { status: 'succeeded', taskID: 'task_1' });
  const first = db.prepare('SELECT status, report FROM workflow_runs WHERE id=?').get('run_1');
  assert.equal(first.status, 'succeeded');
  assert.ok(first.report);

  // Second call — tries to write failed. Must NOT clobber.
  await onTerminal('run_1', { status: 'failed', reason: 'late_call', taskID: 'task_1' });
  const second = db.prepare('SELECT status, report FROM workflow_runs WHERE id=?').get('run_1');
  assert.equal(second.status, 'succeeded', 'idempotency: terminal row not clobbered');
  assert.equal(second.report, first.report, 'report unchanged on second call');
});

test('onTerminal write failure does NOT crash the queue (next run still dequeues)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  seedRun(db, 'run_2');
  // An onTerminal that throws on the first call (simulating DB write failure).
  let callCount = 0;
  const onTerminal = async (runID, result) => {
    callCount++;
    if (callCount === 1) {
      throw new Error('DB write failed');
    }
    // Second call succeeds — prove the queue survived the first throw.
    db.prepare("UPDATE workflow_runs SET status=?, ended_at=datetime('now') WHERE id=?").run(
      result.status,
      runID
    );
  };
  const fake = makeFakeRunTask();
  const resolve1 = fake.block('run_1');
  const resolve2 = fake.block('run_2'); // block run_2 too so it stays running
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal,
  });
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 10));
  queue.enqueue('wf_1', 'run_2', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 10));

  // Resolve run_1 — onTerminal throws, but the queue must still advance to run_2.
  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 20));

  // run_2 should have dequeued (queue survived the throw) and be running.
  const r2 = db.prepare('SELECT status FROM workflow_runs WHERE id=?').get('run_2');
  assert.equal(r2.status, 'running', 'queue advanced past the failed onTerminal');
  assert.ok(callCount >= 1, 'onTerminal was called (and threw)');
  resolve2({ status: 'success' });
  await new Promise((r) => setTimeout(r, 15));
});
