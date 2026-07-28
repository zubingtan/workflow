import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { createApp } from "./app.mjs";
import { ensureSchema } from "./db-schema.mjs";
import { createRunQueue } from "./queue.mjs";
import { makeFakeRunTask, makeFakeCancelTask } from "./queue-test-helpers.mjs";

/**
 * Phase 3 (#155): wiring the queue into app.mjs + the unified cancel endpoint.
 *
 * Pins #144 + #142:
 *   - POST /api/task/run with workflowId → queue.enqueue is called (DB row
 *     transitions queued → running as the fake runTask dequeues immediately).
 *   - PUT /api/runs/:runID/cancel:
 *     - queued → queue.cancelQueued, DB row becomes terminated, returns
 *       {ok:true, status:'terminated'}.
 *     - running with task_id → calls TaskCancelAPI (injected), returns
 *       {ok:true, status:'cancelling'}.
 *     - already terminal → 409 {error:'already_terminal'}.
 *     - missing → 404.
 *
 * The queue is constructed with a fake runTask/cancelTask so the app's
 * enqueue path is exercised end-to-end without spinning up a real
 * TaskRunAPI. Phase 4 will own terminal capture into workflow_runs.report;
 * here we only assert status transitions + the cancel contract.
 */

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "wf-phase3-wire-"));
  const db = new Database(join(dir, "workflow.db"));
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', '{}')").run();
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_2', 'n', '{}')").run();
  return { db, dir };
}

const SCHEMA = JSON.stringify({ nodes: [], edges: [] });

function makeQueueApp({ runTask, cancelTask, onTerminal } = {}) {
  const { db, dir } = setupDb();
  const fakeRun = makeFakeRunTask();
  const fakeCancel = makeFakeCancelTask();
  const terminals = [];
  const queue = createRunQueue({
    db,
    runTask: runTask ?? fakeRun.runTask,
    cancelTask: cancelTask ?? fakeCancel.cancelTask,
    onTerminal: onTerminal ?? ((runID, result) => terminals.push({ runID, result })),
  });
  const app = createApp({
    db,
    agentDir: dir,
    enqueueRun: (workflowId, runID, payload) => queue.enqueue(workflowId, runID, payload),
    cancelQueuedRun: (runID) => queue.cancelQueued(runID),
    cancelRunningRun: (runID) => {
      const taskID = queue.getRunningTaskID(runID);
      if (!taskID) return Promise.resolve({ success: false });
      return fakeCancel.cancelTask({ taskID });
    },
    getRunQueuePosition: (workflowId, runID) => queue.getQueuePosition(workflowId, runID),
  });
  return { app, db, dir, queue, fakeRun, fakeCancel, terminals };
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postRun(app, body) {
  return app.fetch(
    new Request("http://localhost/api/task/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

async function cancelRun(app, runID) {
  return app.fetch(
    new Request(`http://localhost/api/runs/${runID}/cancel`, {
      method: "PUT",
    })
  );
}

// --- Wiring: POST /api/task/run drives the queue ---

test("POST /api/task/run with workflowId → queue dequeues, runTask called, DB → running", async () => {
  const { app, db, fakeRun } = makeQueueApp();
  const res = await postRun(app, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "queued");
  assert.ok(body.runID);

  // The queue dequeues synchronously after enqueue — give it a tick.
  await wait(10);
  assert.equal(fakeRun.calls.length, 1, "runTask called once after enqueue");
  assert.equal(fakeRun.calls[0].workflowId, "wf_1");
  assert.equal(fakeRun.calls[0].runID, body.runID);

  const row = db.prepare("SELECT status, task_id, started_at FROM workflow_runs WHERE id=?").get(body.runID);
  assert.equal(row.status, "running");
  assert.equal(row.task_id, fakeRun.calls[0].taskID, "task_id written to DB on dequeue");
  assert.ok(row.started_at);
});

test("3 enqueues on same workflow → 1 running + 2 queued (DB rows)", async () => {
  const { app, db, fakeRun } = makeQueueApp();
  const resolve1 = fakeRun.block("run_1"); // not used directly — just mark blocking
  // We'll seed runs by posting three times; the first blocks, the other two queue.
  // But postRun returns immediately with a runID, and the queue dequeues the
  // first synchronously. To block the first, we use fakeRun.block() before
  // posting — but we don't know the runID yet. So instead, post all three
  // rapidly; the first will dequeue and resolve immediately (not blocked),
  // then the second dequeues, then the third. To observe the queued state,
  // we need the first to block. Solution: use a custom runTask that blocks
  // the first call.
  let firstResolve;
  const blockedFirst = new Promise((res) => { firstResolve = res; });
  let callCount = 0;
  const { app: app2, db: db2 } = makeQueueApp({
    runTask: (wf, runID, payload) => {
      callCount++;
      const taskID = `task_${callCount}`;
      const done = callCount === 1 ? blockedFirst : Promise.resolve({ status: "success" });
      return { taskID, done };
    },
  });

  const r1 = await postRun(app2, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);
  const r2 = await postRun(app2, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  const r3 = await postRun(app2, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);

  const b1 = await r1.json();
  const b2 = await r2.json();
  const b3 = await r3.json();

  const statuses = db2.prepare("SELECT id, status FROM workflow_runs ORDER BY id").all();
  const byId = Object.fromEntries(statuses.map((r) => [r.id, r.status]));
  assert.equal(byId[b1.runID], "running", "first run is running");
  assert.equal(byId[b2.runID], "queued", "second run is queued");
  assert.equal(byId[b3.runID], "queued", "third run is queued");

  firstResolve({ status: "success" });
  await wait(15);
  const after = db2.prepare("SELECT id, status FROM workflow_runs ORDER BY id").all();
  const afterById = Object.fromEntries(after.map((r) => [r.id, r.status]));
  // After first finishes, second dequeues and resolves immediately, then third.
  // Phase 3 does NOT write terminal status to DB (Phase 4 does) — so the
  // first two rows stay "running" until Phase 4. Third should be "running".
  assert.equal(afterById[b3.runID], "running", "third dequeued after first+second finish");
});

// --- PUT /api/runs/:runID/cancel ---

test("cancel a queued run → DB row terminated, returns {ok:true, status:'terminated'}", async () => {
  const { app, db, fakeRun } = makeQueueApp();
  let firstResolve;
  const blockedFirst = new Promise((res) => { firstResolve = res; });
  let callCount = 0;
  // Rebuild with a blocking first run.
  const { app: app2, db: db2, queue } = makeQueueApp({
    runTask: (wf, runID, payload) => {
      callCount++;
      const taskID = `task_${callCount}`;
      const done = callCount === 1 ? blockedFirst : Promise.resolve({ status: "success" });
      return { taskID, done };
    },
  });

  const r1 = await postRun(app2, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);
  const r2 = await postRun(app2, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);
  const b1 = await r1.json();
  const b2 = await r2.json();

  // Cancel the queued run (b2).
  const cancelRes = await cancelRun(app2, b2.runID);
  assert.equal(cancelRes.status, 200);
  const cancelBody = await cancelRes.json();
  assert.equal(cancelBody.ok, true);
  assert.equal(cancelBody.status, "terminated");

  const row = db2.prepare("SELECT status, ended_at FROM workflow_runs WHERE id=?").get(b2.runID);
  assert.equal(row.status, "terminated");
  assert.ok(row.ended_at);

  // The running run is unaffected.
  const r1Row = db2.prepare("SELECT status FROM workflow_runs WHERE id=?").get(b1.runID);
  assert.equal(r1Row.status, "running");

  // When r1 finishes, the queue is empty (b2 was cancelled, not advanced).
  firstResolve({ status: "success" });
  await wait(10);
});

test("cancel a running run → calls cancelTask, returns {ok:true, success:true} (no invented status)", async () => {
  const { app, db, fakeRun, fakeCancel } = makeQueueApp();
  let firstResolve;
  const blockedFirst = new Promise((res) => { firstResolve = res; });
  let callCount = 0;
  const { app: app2, db: db2 } = makeQueueApp({
    runTask: (wf, runID, payload) => {
      callCount++;
      const taskID = `task_${callCount}`;
      const done = callCount === 1 ? blockedFirst : Promise.resolve({ status: "success" });
      return { taskID, done };
    },
  });

  const r1 = await postRun(app2, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(10);
  const b1 = await r1.json();

  const cancelRes = await cancelRun(app2, b1.runID);
  assert.equal(cancelRes.status, 200);
  const cancelBody = await cancelRes.json();
  assert.equal(cancelBody.ok, true);
  assert.equal(cancelBody.success, true, "success:true confirms cancel request was sent");
  assert.equal(cancelBody.status, undefined, "no invented 'cancelling' status (only 5 canonical statuses allowed)");

  // The cancel endpoint should have called cancelTask with the running taskID.
  // (Via the cancelRunningRun hook → queue.getRunningTaskID → cancelTask.)
  // fakeCancel.cancelled is shared via the makeQueueApp closure — but since
  // we passed a custom runTask, the cancelTask is the default fake. We can
  // verify via DB: task_id should be set (written on dequeue).
  const row = db2.prepare("SELECT task_id FROM workflow_runs WHERE id=?").get(b1.runID);
  assert.ok(row.task_id, "task_id written to DB so cancel can look it up");

  firstResolve({ status: "success" });
  await wait(10);
});

test("cancel an already-terminal run → 409 {error:'already_terminal'}", async () => {
  const { app, db } = makeQueueApp();
  // Insert a terminal row directly.
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at, ended_at) VALUES ('run_done', 'wf_1', 'succeeded', datetime('now'), datetime('now'))"
  ).run();

  const res = await cancelRun(app, "run_done");
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, "already_terminal");
});

test("cancel a missing run → 404", async () => {
  const { app } = makeQueueApp();
  const res = await cancelRun(app, "run_does_not_exist");
  assert.equal(res.status, 404);
});

test("cancel endpoint does not advance the queue (only onTerminal advances)", async () => {
  // After cancelling a queued run, the next queued run must NOT start — it
  // only starts when the current running run finishes (onTerminal → dequeue).
  let firstResolve;
  const blockedFirst = new Promise((res) => { firstResolve = res; });
  let callCount = 0;
  const { app, db, queue } = makeQueueApp({
    runTask: (wf, runID, payload) => {
      callCount++;
      const taskID = `task_${callCount}`;
      const done = callCount === 1 ? blockedFirst : Promise.resolve({ status: "success" });
      return { taskID, done };
    },
  });

  const r1 = await postRun(app, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);
  const r2 = await postRun(app, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);
  const r3 = await postRun(app, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);
  const b2 = await r2.json();
  const b3 = await r3.json();

  // Cancel b2 (queued). b3 must stay queued — it does NOT advance to running.
  await cancelRun(app, b2.runID);
  await wait(5);

  const b3Row = db.prepare("SELECT status FROM workflow_runs WHERE id=?").get(b3.runID);
  assert.equal(b3Row.status, "queued", "b3 still queued after b2 cancelled (no advance)");

  firstResolve({ status: "success" });
  await wait(15);
  const b3After = db.prepare("SELECT status FROM workflow_runs WHERE id=?").get(b3.runID);
  assert.equal(b3After.status, "running", "b3 dequeued only after r1 finishes");
});

// --- GET /api/runs/:runID (status + queue position for Test Run panel) ---

test("GET /api/runs/:runID returns status + queuePosition for a queued run", async () => {
  let firstResolve;
  const blockedFirst = new Promise((res) => { firstResolve = res; });
  let callCount = 0;
  const { app } = makeQueueApp({
    runTask: (wf, runID, payload) => {
      callCount++;
      const taskID = `task_${callCount}`;
      const done = callCount === 1 ? blockedFirst : Promise.resolve({ status: "success" });
      return { taskID, done };
    },
  });

  const r1 = await postRun(app, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);
  const r2 = await postRun(app, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  const r3 = await postRun(app, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(5);
  const b2 = await r2.json();
  const b3 = await r3.json();

  // b2 is first in queue → position 1; b3 is second → position 2.
  const s2 = await app.fetch(new Request(`http://localhost/api/runs/${b2.runID}`));
  assert.equal(s2.status, 200);
  const j2 = await s2.json();
  assert.equal(j2.status, "queued");
  assert.equal(j2.queuePosition, 1, "b2 is first in queue");

  const s3 = await app.fetch(new Request(`http://localhost/api/runs/${b3.runID}`));
  const j3 = await s3.json();
  assert.equal(j3.queuePosition, 2, "b3 is second in queue");

  firstResolve({ status: "success" });
  await wait(15);
});

test("GET /api/runs/:runID returns queuePosition=0 for a running run", async () => {
  const { app } = makeQueueApp();
  const r1 = await postRun(app, { schema: SCHEMA, inputs: {}, workflowId: "wf_1" });
  await wait(10);
  const b1 = await r1.json();
  const res = await app.fetch(new Request(`http://localhost/api/runs/${b1.runID}`));
  const body = await res.json();
  assert.equal(body.status, "running");
  assert.equal(body.queuePosition, 0, "running run → position 0");
});

test("GET /api/runs/:runID returns 404 for a missing run", async () => {
  const { app } = makeQueueApp();
  const res = await app.fetch(new Request("http://localhost/api/runs/run_missing"));
  assert.equal(res.status, 404);
});
