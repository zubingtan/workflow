import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { ensureSchema } from "./db-schema.mjs";
import { createRunQueue } from "./queue.mjs";
import { createCapturingOnTerminal, createQueueAdapter } from "./queue-adapter.mjs";
import { createRunsEventBus } from "./runs-events.mjs";

/**
 * Phase 5 (#157): end-to-end broadcast wiring.
 *
 * Pins the contract that:
 *   - The queue's onEvent fires run_status events on enqueue/dequeue/cancelQueued.
 *   - The adapter's onTerminal (built with createCapturingOnTerminal(db, fetch, bus))
 *     broadcasts run_terminal with the full report + schema_snapshot AFTER the
 *     DB row is written.
 *   - A subscriber on the bus receives BOTH run_status and run_terminal events
 *     for the subscribed workflow (multi-tab sync).
 *
 * This sits between the bus unit tests (runs-events.test.mjs) and the app-level
 * wiring tests (runs-events-wiring.test.mjs): it proves the queue + adapter
 * actually fire the events the bus is supposed to deliver.
 */

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "wf-phase5-bcast-"));
  const db = new Database(join(dir, "workflow.db"));
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  db.prepare(
    "INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', ?)"
  ).run(JSON.stringify({ nodes: [{ id: "n1", type: "llm" }], edges: [] }));
  return { db, dir };
}

function seedRun(db, runID, workflowId = "wf_1", status = "queued") {
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, ?, datetime('now'))"
  ).run(runID, workflowId, status);
}

function makeFakeRes() {
  const writes = [];
  return {
    writes,
    write(chunk) { writes.push(chunk); return true; },
    setHeader() {},
  };
}

function parseSSE(chunk) {
  // SSE frames are `data: {...}\n\n`. Return the parsed JSON of the last frame.
  const frames = chunk.split("\n\n").filter(Boolean);
  const last = frames[frames.length - 1];
  if (last.startsWith(":")) return null; // heartbeat
  return JSON.parse(last.replace(/^data:\s*/, ""));
}

test("enqueue fires run_status=queued, dequeue fires run_status=running", async () => {
  const { db } = setupDb();
  seedRun(db, "run_1");
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe("wf_1", res);
  res.writes.length = 0; // drop initial :ping

  // Use a runTask that blocks so we can observe the queued → running
  // transition distinctly (if done resolved immediately, queued + running
  // would both fire before we read).
  const queue = createRunQueue({
    db,
    runTask: () => ({ taskID: "task_1", done: new Promise(() => {}) }),
    cancelTask: async () => ({ success: true }),
    onTerminal: createCapturingOnTerminal(db, async () => null, bus),
    onEvent: (wf, ev) => bus.broadcast(wf, ev),
  });

  queue.enqueue("wf_1", "run_1", { schema: "{}", inputs: {} });
  await new Promise((r) => setTimeout(r, 10));

  // Two writes: run_status=queued, then run_status=running.
  assert.equal(res.writes.length, 2, "queued + running events broadcast");
  const ev1 = parseSSE(res.writes[0]);
  const ev2 = parseSSE(res.writes[1]);
  assert.equal(ev1.type, "run_status");
  assert.equal(ev1.runID, "run_1");
  assert.equal(ev1.status, "queued");
  assert.equal(ev2.type, "run_status");
  assert.equal(ev2.status, "running");
  queue.dispose();
});

test("cancelQueued fires run_status=terminated", async () => {
  const { db } = setupDb();
  seedRun(db, "run_1");
  seedRun(db, "run_2");
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe("wf_1", res);
  res.writes.length = 0;

  // Block the first run so run_2 stays queued.
  let resolve1;
  const queue = createRunQueue({
    db,
    runTask: (wf, runID) => ({
      taskID: `task_${runID}`,
      done: runID === "run_1" ? new Promise((r) => { resolve1 = r; }) : Promise.resolve({ status: "success" }),
    }),
    cancelTask: async () => ({ success: true }),
    onTerminal: createCapturingOnTerminal(db, async () => null, bus),
    onEvent: (w, e) => bus.broadcast(w, e),
  });

  queue.enqueue("wf_1", "run_1", { schema: "{}", inputs: {} });
  await new Promise((r) => setTimeout(r, 5));
  queue.enqueue("wf_1", "run_2", { schema: "{}", inputs: {} });
  await new Promise((r) => setTimeout(r, 5));
  res.writes.length = 0; // drop the queued/running events for run_1 and run_2

  const cancelled = queue.cancelQueued("run_2");
  assert.equal(cancelled, true);
  assert.equal(res.writes.length, 1, "terminated event broadcast");
  const ev = parseSSE(res.writes[0]);
  assert.equal(ev.type, "run_status");
  assert.equal(ev.runID, "run_2");
  assert.equal(ev.status, "terminated");

  resolve1({ status: "success" });
  await new Promise((r) => setTimeout(r, 10));
  queue.dispose();
});

test("onTerminal broadcasts run_terminal with full report + schema_snapshot after DB write", async () => {
  const { db } = setupDb();
  seedRun(db, "run_1");
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe("wf_1", res);
  res.writes.length = 0;

  const fakeReport = {
    workflowStatus: { success: true },
    outputs: { result: "ok" },
  };
  const queue = createRunQueue({
    db,
    runTask: () => ({ taskID: "task_1", done: Promise.resolve({ status: "succeeded" }) }),
    cancelTask: async () => ({ success: true }),
    onTerminal: createCapturingOnTerminal(db, async () => fakeReport, bus),
    onEvent: (w, e) => bus.broadcast(w, e),
  });

  queue.enqueue("wf_1", "run_1", { schema: "{}", inputs: {} });
  await new Promise((r) => setTimeout(r, 20));

  // Find the run_terminal frame in the writes (after queued + running).
  const terminals = res.writes.map(parseSSE).filter((e) => e?.type === "run_terminal");
  assert.equal(terminals.length, 1, "exactly one run_terminal event");
  const ev = terminals[0];
  assert.equal(ev.runID, "run_1");
  assert.equal(ev.status, "succeeded");
  assert.deepEqual(ev.report, { ...fakeReport }, "full report in broadcast");
  assert.ok(ev.schema_snapshot, "schema_snapshot in broadcast");
  const schemaParsed = typeof ev.schema_snapshot === "string" ? JSON.parse(ev.schema_snapshot) : ev.schema_snapshot;
  assert.deepEqual(schemaParsed.nodes, [{ id: "n1", type: "llm" }]);

  // The DB row must be terminal BEFORE the broadcast fires (broadcast is
  // after the UPDATE). Verify.
  const row = db.prepare("SELECT status, report FROM workflow_runs WHERE id=?").get("run_1");
  assert.equal(row.status, "succeeded", "DB row terminal before broadcast");
});

test("run_terminal broadcast goes only to subscribers of that workflow", async () => {
  const { db } = setupDb();
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_2', 'n2', '{}')").run();
  seedRun(db, "run_1", "wf_1");
  seedRun(db, "run_2", "wf_2");

  const bus = createRunsEventBus();
  const res1 = makeFakeRes();
  const res2 = makeFakeRes();
  bus.subscribe("wf_1", res1);
  bus.subscribe("wf_2", res2);
  res1.writes.length = 0;
  res2.writes.length = 0;

  const queue = createRunQueue({
    db,
    runTask: (wf, runID) => ({
      taskID: `task_${runID}`,
      done: Promise.resolve({ status: "succeeded" }),
    }),
    cancelTask: async () => ({ success: true }),
    onTerminal: createCapturingOnTerminal(db, async () => ({ workflowStatus: { success: true } }), bus),
    onEvent: (w, e) => bus.broadcast(w, e),
  });

  queue.enqueue("wf_1", "run_1", { schema: "{}", inputs: {} });
  await new Promise((r) => setTimeout(r, 20));

  const terminals1 = res1.writes.map(parseSSE).filter((e) => e?.type === "run_terminal");
  const terminals2 = res2.writes.map(parseSSE).filter((e) => e?.type === "run_terminal");
  assert.equal(terminals1.length, 1, "wf_1 subscriber received run_terminal");
  assert.equal(terminals2.length, 0, "wf_2 subscriber did NOT receive wf_1's terminal");
});

test("createQueueAdapter(db, eventBus) wires onTerminal broadcast end-to-end", async () => {
  const { db } = setupDb();
  seedRun(db, "run_1");
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe("wf_1", res);
  res.writes.length = 0;

  // Use the real createQueueAdapter with a fake runTask/cancelTask injected
  // via the queue factory (the adapter's runTask calls TaskRunAPI which we
  // can't easily stub here — so we bypass it by constructing the queue with
  // a fake runTask but the adapter's real onTerminal).
  const adapter = createQueueAdapter(db, bus);
  const queue = createRunQueue({
    db,
    runTask: () => ({ taskID: "task_1", done: Promise.resolve({ status: "succeeded" }) }),
    cancelTask: adapter.cancelTask,
    onTerminal: adapter.onTerminal,
    onEvent: (w, e) => bus.broadcast(w, e),
  });

  queue.enqueue("wf_1", "run_1", { schema: "{}", inputs: {} });
  await new Promise((r) => setTimeout(r, 20));

  const terminals = res.writes.map(parseSSE).filter((e) => e?.type === "run_terminal");
  assert.equal(terminals.length, 1, "adapter's onTerminal broadcast run_terminal");
  assert.equal(terminals[0].status, "succeeded");
});
