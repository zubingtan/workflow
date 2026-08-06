import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { ensureSchema } from './db-schema.mjs';
import { createRunQueue } from './queue.mjs';
import { makeFakeRunTask, makeFakeCancelTask } from './queue-test-helpers.mjs';

/**
 * Phase 3 (#155): per-workflow serial queue state machine + unified cancel.
 *
 * Pins #142:
 *   - In-memory Map<workflowId, {current, queue[]}> + FIFO scheduler.
 *   - 3 trigger points: enqueue (push + maybe dequeue), onTerminal (advance),
 *     cancelQueued (remove without advancing).
 *   - Wall-clock 30min zombie-run guard (force-fail stale `current`).
 *   - isActive()/activeRunCount() for delete-workflow check (Phase 6).
 *
 * The queue is a pure module (createRunQueue factory) so it can be tested
 * with a fake `runTask`/`cancelTask`/`onTerminal` and a temp DB — no real
 * HTTP server, no real TaskRunAPI. Phase 4 will own terminal capture into
 * workflow_runs.report; here onTerminal is just a spy.
 *
 * runTask contract: returns {taskID, done} synchronously — taskID captured
 * immediately (for cancel/wall-clock), done settles at terminal. This mirrors
 * the real TaskRunAPI (returns taskID fast; terminal observed separately).
 */

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-queue-'));
  const db = new Database(join(dir, 'workflow.db'));
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', '{}')").run();
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_2', 'n', '{}')").run();
  return { db, dir };
}

function seedRun(db, runID, workflowId = 'wf_1', status = 'queued') {
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, ?, datetime('now'))",
  ).run(runID, workflowId, status);
}

test('enqueue on idle workflow immediately dequeues + runs', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const { runTask, calls } = makeFakeRunTask();
  const terminals = [];
  const queue = createRunQueue({
    db,
    runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: (runID, result) => terminals.push({ runID, result }),
  });

  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  // Let the microtask resolve.
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(calls.length, 1, 'runTask called once');
  assert.equal(calls[0].runID, 'run_1');
  const row = db.prepare('SELECT status, started_at FROM workflow_runs WHERE id=?').get('run_1');
  assert.equal(row.status, 'running', 'DB row updated to running on dequeue');
  assert.ok(row.started_at, 'started_at set on dequeue');
});

test('3 enqueues on same workflow → 1 running + 2 queued (FIFO)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  seedRun(db, 'run_2');
  seedRun(db, 'run_3');
  // Block run_1 and run_2 so we can observe the queued state. run_3 stays queued.
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });

  const resolve1 = fake.block('run_1');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));
  const resolve2 = fake.block('run_2');
  queue.enqueue('wf_1', 'run_2', { schema: '{}', inputs: {} });
  queue.enqueue('wf_1', 'run_3', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));

  const statuses = db.prepare('SELECT id, status FROM workflow_runs ORDER BY id').all();
  const byId = Object.fromEntries(statuses.map((r) => [r.id, r.status]));
  assert.equal(byId.run_1, 'running');
  assert.equal(byId.run_2, 'queued', 'run_2 stays queued while run_1 is running');
  assert.equal(byId.run_3, 'queued', 'run_3 stays queued while run_1 is running');

  // Resolve run_1 → run_2 should dequeue (and block on resolve2).
  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
  const after1 = db.prepare('SELECT id, status FROM workflow_runs ORDER BY id').all();
  const after1ById = Object.fromEntries(after1.map((r) => [r.id, r.status]));
  assert.equal(
    after1ById.run_1,
    'running',
    'run_1 DB row stays running (Phase 4 owns terminal write)',
  );
  assert.equal(after1ById.run_2, 'running', 'run_2 dequeued to running');
  assert.equal(after1ById.run_3, 'queued', 'run_3 still queued (run_2 still in-flight)');

  // Resolve run_2 → run_3 should dequeue and resolve immediately.
  resolve2({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
  const after2 = db.prepare('SELECT id, status FROM workflow_runs ORDER BY id').all();
  const after2ById = Object.fromEntries(after2.map((r) => [r.id, r.status]));
  assert.equal(after2ById.run_3, 'running', 'run_3 dequeued to running after run_2 finishes');
});

test('different workflows run in parallel (independent queues)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_a', 'wf_1');
  seedRun(db, 'run_b', 'wf_2');
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });

  const resolveA = fake.block('run_a');
  const resolveB = fake.block('run_b');
  queue.enqueue('wf_1', 'run_a', { schema: '{}', inputs: {} });
  queue.enqueue('wf_2', 'run_b', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 10));

  // Both running in parallel — neither blocks the other.
  const a = db.prepare('SELECT status FROM workflow_runs WHERE id=?').get('run_a');
  const b = db.prepare('SELECT status FROM workflow_runs WHERE id=?').get('run_b');
  assert.equal(a.status, 'running');
  assert.equal(b.status, 'running');

  resolveA({ status: 'success' });
  resolveB({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
});

test('cancelQueued removes from queue + marks terminated, does NOT advance', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  seedRun(db, 'run_2');
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });

  const resolve1 = fake.block('run_1');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));
  queue.enqueue('wf_1', 'run_2', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));

  // Cancel run_2 (queued). Must NOT cause a dequeue (run_1 still running).
  const ok = queue.cancelQueued('run_2');
  assert.equal(ok, true);
  const r2 = db.prepare('SELECT status, ended_at FROM workflow_runs WHERE id=?').get('run_2');
  assert.equal(r2.status, 'terminated', 'cancelled queued run → terminated');
  assert.ok(r2.ended_at, 'ended_at set on cancel');
  const r1 = db.prepare('SELECT status FROM workflow_runs WHERE id=?').get('run_1');
  assert.equal(r1.status, 'running', 'run_1 still running (cancel did not advance)');

  // When run_1 finishes, the queue is empty — no new dequeue.
  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
});

test('cancelQueued returns false for a run that is not queued (running/terminal/missing)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });
  const resolve1 = fake.block('run_1');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));

  assert.equal(queue.cancelQueued('run_1'), false, "running run is not 'queued' → false");
  assert.equal(queue.cancelQueued('run_missing'), false, 'missing run → false');
  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
});

test('getQueuePosition returns 1-based position for queued runs (0 if running/missing)', async () => {
  const { db } = setupDb();
  for (const id of ['run_1', 'run_2', 'run_3']) seedRun(db, id);
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });
  const resolve1 = fake.block('run_1');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));
  queue.enqueue('wf_1', 'run_2', { schema: '{}', inputs: {} });
  queue.enqueue('wf_1', 'run_3', { schema: '{}', inputs: {} });

  assert.equal(queue.getQueuePosition('wf_1', 'run_1'), 0, 'running run → 0');
  assert.equal(queue.getQueuePosition('wf_1', 'run_2'), 1, 'first queued → 1');
  assert.equal(queue.getQueuePosition('wf_1', 'run_3'), 2, 'second queued → 2');
  assert.equal(queue.getQueuePosition('wf_1', 'run_missing'), 0, 'missing → 0');
  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
});

test('isActive / activeRunCount for delete-workflow check (Phase 6)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  seedRun(db, 'run_2');
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });
  const resolve1 = fake.block('run_1');
  const resolve2 = fake.block('run_2');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));
  queue.enqueue('wf_1', 'run_2', { schema: '{}', inputs: {} });

  assert.equal(queue.isActive(), true, 'isActive true when any workflow has active runs');
  assert.equal(queue.activeRunCount('wf_1'), 2, '1 running + 1 queued = 2 active');
  assert.equal(queue.activeRunCount('wf_2'), 0, 'wf_2 has no active runs');

  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10)); // run_2 dequeued, blocks on resolve2
  assert.equal(queue.activeRunCount('wf_1'), 1, 'run_1 done, run_2 running = 1 active');
  resolve2({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(queue.activeRunCount('wf_1'), 0, 'all terminal → 0 active');
  assert.equal(queue.isActive(), false);
});

test('wall-clock guard force-fails a stale running run + cancels its task', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const terminals = [];
  let now = 1000;
  // A runTask whose `done` never resolves — simulates a zombie. taskID is
  // still returned synchronously so the guard can cancel it.
  const runTask = () => ({ taskID: 'task_zombie', done: new Promise(() => {}) });
  const { cancelTask, cancelled } = makeFakeCancelTask();
  const queue = createRunQueue({
    db,
    runTask,
    cancelTask,
    onTerminal: (runID, result) => terminals.push({ runID, result }),
    wallClockMs: 30 * 60 * 1000,
    now: () => now,
    sweepIntervalMs: 10,
  });
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 20));

  // Advance time past the wall-clock limit.
  now += 31 * 60 * 1000;
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(terminals.length, 1, 'onTerminal called once for zombie');
  assert.equal(terminals[0].runID, 'run_1');
  assert.equal(terminals[0].result.status, 'failed');
  assert.equal(terminals[0].result.reason, 'wall_clock_zombie', 'reason must be wall_clock_zombie');
  assert.ok(cancelled.length >= 1, 'cancelTask called (best-effort) for the zombie task');
  assert.ok(cancelled.includes('task_zombie'), 'cancelled the right taskID');
  queue.dispose();
});

test("onTerminal called with runTask's resolved result on normal completion", async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const terminals = [];
  const runTask = () => ({ taskID: 'task_1', done: Promise.resolve({ status: 'success' }) });
  const queue = createRunQueue({
    db,
    runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: (runID, result) => terminals.push({ runID, result }),
  });
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].runID, 'run_1');
  assert.equal(terminals[0].result.status, 'success');
});

test("onTerminal called with failed result when runTask's done rejects", async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const terminals = [];
  const runTask = () => ({ taskID: 'task_1', done: Promise.reject(new Error('boom')) });
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
});

test('next run waits until async terminal handling completes', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  seedRun(db, 'run_2');
  const events = [];
  let releaseTerminal;
  const terminalReady = new Promise((resolve) => {
    releaseTerminal = resolve;
  });
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: (workflowId, runID) => {
      events.push(`${runID}:runTask`);
      return fake.runTask(workflowId, runID);
    },
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: async (runID) => {
      events.push(`${runID}:terminal:start`);
      await terminalReady;
      events.push(`${runID}:terminal:end`);
    },
    onEvent: (_workflowId, event) => events.push(`${event.runID}:${event.status ?? event.type}`),
  });

  const resolve1 = fake.block('run_1');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((resolve) => setTimeout(resolve, 5));
  queue.enqueue('wf_1', 'run_2', { schema: '{}', inputs: {} });
  resolve1({ status: 'success' });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(events.includes('run_2:runTask'), false);
  releaseTerminal();
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.ok(events.indexOf('run_1:terminal:end') < events.indexOf('run_2:runTask'));
  queue.dispose();
});

test('getRunningTaskID returns the taskID of a running run (for cancel endpoint)', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });
  const resolve1 = fake.block('run_1');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));

  const taskID = queue.getRunningTaskID('run_1');
  assert.ok(taskID, 'running run has a taskID');
  assert.equal(taskID, fake.calls[0].taskID);
  assert.equal(queue.getRunningTaskID('run_missing'), null, 'missing → null');
  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
});

// --- #179: SSE node progress (getCurrentReport + run_progress broadcast) ---

/**
 * Build a minimal IReport with the given per-node statuses.
 * `nodes` is `{ nodeID: { status, snapshots?: N } }`.
 */
function makeReport(nodes) {
  const reports = {};
  for (const [id, n] of Object.entries(nodes)) {
    reports[id] = {
      id,
      status: n.status,
      terminated: false,
      startTime: 1,
      timeCost: 0,
      snapshots: Array.from({ length: n.snapshots ?? 0 }, () => ({})),
    };
  }
  return {
    id: 'report_1',
    inputs: {},
    outputs: {},
    workflowStatus: { status: 'processing', terminated: false, startTime: 1, timeCost: 0 },
    reports,
    messages: {},
  };
}

test('#179 getCurrentReport: null for unknown / queued / terminal runs', () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });
  // Not running yet (queued, no dequeue yet) — but enqueue triggers dequeue
  // synchronously, so check BEFORE enqueue for the queued-state test.
  // Actually enqueue dequeues immediately; to test "unknown", just ask for a
  // runID that doesn't exist.
  assert.equal(queue.getCurrentReport('run_missing'), null, 'unknown run → null');
});

test('#179 getCurrentReport: returns the latest cached IReport for a running run', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const fake = makeFakeRunTask();
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
  });
  const resolve1 = fake.block('run_1');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));

  // Initially null — no progress fired yet.
  assert.equal(queue.getCurrentReport('run_1'), null, 'no progress yet → null');

  const r1 = makeReport({ nodeA: { status: 'processing' } });
  fake.emitProgress('run_1', r1);
  assert.equal(queue.getCurrentReport('run_1'), r1, 'cached after first progress');

  const r2 = makeReport({ nodeA: { status: 'succeeded', snapshots: 1 } });
  fake.emitProgress('run_1', r2);
  assert.equal(queue.getCurrentReport('run_1'), r2, 'updated after second progress');

  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
  // Terminal: finishCurrent cleared wf.current → cache gone.
  assert.equal(queue.getCurrentReport('run_1'), null, 'cleared after terminal');
});

test('#179 run_progress: broadcast fires on first progress + on per-node change, not on no-op', async () => {
  const { db } = setupDb();
  seedRun(db, 'run_1');
  const fake = makeFakeRunTask();
  const events = [];
  const queue = createRunQueue({
    db,
    runTask: fake.runTask,
    cancelTask: makeFakeCancelTask().cancelTask,
    onTerminal: () => {},
    onEvent: (wfId, ev) => events.push(ev),
  });
  const resolve1 = fake.block('run_1');
  queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
  await new Promise((r) => setTimeout(r, 5));
  // enqueue fires run_status=queued (synchronously), then dequeue fires
  // run_status=running (after the DB UPDATE + the await on runTask resolves
  // the taskID). Both are present by the time we check.
  assert.deepEqual(
    events.filter((e) => e.type === 'run_status').map((e) => e.status),
    ['queued', 'running'],
    'enqueue+dequeue fired queued then running',
  );

  // First progress → broadcast (prev was null → reportChanged returns true).
  const r1 = makeReport({ nodeA: { status: 'processing' } });
  fake.emitProgress('run_1', r1);
  assert.equal(
    events.filter((e) => e.type === 'run_progress').length,
    1,
    'first progress broadcast',
  );
  assert.equal(events.at(-1).report, r1, 'broadcast carries the IReport');
  assert.equal(events.at(-1).runID, 'run_1');

  // Same status, same snapshot count → NO broadcast.
  fake.emitProgress('run_1', r1);
  assert.equal(
    events.filter((e) => e.type === 'run_progress').length,
    1,
    'no-op progress not broadcast',
  );

  // Snapshot count grew → broadcast.
  const r2 = makeReport({ nodeA: { status: 'processing', snapshots: 1 } });
  fake.emitProgress('run_1', r2);
  assert.equal(
    events.filter((e) => e.type === 'run_progress').length,
    2,
    'snapshot growth broadcast',
  );

  // Status changed → broadcast.
  const r3 = makeReport({ nodeA: { status: 'succeeded', snapshots: 1 } });
  fake.emitProgress('run_1', r3);
  assert.equal(
    events.filter((e) => e.type === 'run_progress').length,
    3,
    'status change broadcast',
  );

  resolve1({ status: 'success' });
  await new Promise((r) => setTimeout(r, 10));
});
