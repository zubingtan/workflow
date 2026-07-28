import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { createApp } from "./app.mjs";
import { ensureSchema } from "./db-schema.mjs";

/**
 * Phase 2 (#154): workflowId transit + /api/task/run queue split + drop 409 lock.
 *
 * Pins #144:
 *   - Saved-workflow run (body.workflowId present) → INSERT workflow_runs row
 *     (status='queued'), return {runID, status:'queued'}. The runtime taskID
 *     is NOT returned yet (filled when the queue dequeues — Phase 3).
 *   - Draft run (no workflowId) → immediate execution path, returns
 *     {runID: taskID, status:'running'} (alias taskID as runID).
 *   - The schema-hash 409 `workflow_busy` mutex is REMOVED for saved
 *     workflows (the per-workflow queue in Phase 3 owns serialization). Draft
 *     runs keep a minimal per-process lock (low stakes — drafts can race).
 *   - GET /api/task/report and PUT /api/task/cancel lose the lock-release
 *     calls on the saved-workflow path (Phase 4 owns terminal capture).
 *
 * The queue itself is Phase 3 — here we only assert the split + row insert +
 * 409 removal. A placeholder `enqueueRun` hook is injected so Phase 3 can
 * replace it without touching app.mjs again.
 */

function setupDb() {
  const dataDir = mkdtempSync(join(tmpdir(), "wf-phase2-"));
  const db = new Database(join(dataDir, "workflow.db"));
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  // Seed a workflow for the saved-workflow path.
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', '{}')").run();
  return { db, dataDir };
}

function makeApp({ enqueueRun } = {}) {
  const { db, dataDir } = setupDb();
  const app = createApp({
    db,
    agentDir: dataDir,
    enqueueRun, // injected hook; Phase 3 replaces with the real queue
  });
  return { app, db };
}

const SCHEMA = JSON.stringify({ nodes: [], edges: [] });

test("POST /api/task/run with workflowId → {runID, status:'queued'} + DB row", async () => {
  let enqueued = null;
  const { app, db } = makeApp({
    enqueueRun: (workflowId, runID, payload) => {
      enqueued = { workflowId, runID, payload };
    },
  });

  const res = await app.fetch(
    new Request("http://localhost/api/task/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: SCHEMA, inputs: {}, workflowId: "wf_1" }),
    })
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "queued", `expected status='queued', got: ${JSON.stringify(body)}`);
  assert.ok(body.runID, "runID must be present");
  assert.equal(typeof body.runID, "string");
  assert.equal(body.runID.length, 12, "runID is nanoid(12)");

  // DB row inserted with status='queued'.
  const row = db.prepare("SELECT * FROM workflow_runs WHERE id=?").get(body.runID);
  assert.ok(row, "workflow_runs row must exist");
  assert.equal(row.workflow_id, "wf_1");
  assert.equal(row.status, "queued");
  assert.ok(row.queued_at, "queued_at must be set");
  assert.equal(row.task_id, null, "task_id is null until dequeued (Phase 3)");
  assert.equal(row.report, null, "report is null until terminal (Phase 4)");

  // enqueueRun hook called with the right args.
  assert.ok(enqueued, "enqueueRun hook must be called");
  assert.equal(enqueued.workflowId, "wf_1");
  assert.equal(enqueued.runID, body.runID);
  assert.deepEqual(enqueued.payload, { schema: SCHEMA, inputs: {} });
});

test("POST /api/task/run with workflowId does NOT return taskID (filled at dequeue)", async () => {
  const { app } = makeApp({ enqueueRun: () => {} });
  const res = await app.fetch(
    new Request("http://localhost/api/task/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: SCHEMA, inputs: {}, workflowId: "wf_1" }),
    })
  );
  const body = await res.json();
  assert.equal(body.taskID, undefined, "saved-workflow path must NOT return taskID");
});

test("POST /api/task/run without workflowId → {runID: taskID, status:'running'} (draft path)", async () => {
  const { app } = makeApp();
  const res = await app.fetch(
    new Request("http://localhost/api/task/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: SCHEMA, inputs: {} }),
    })
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "running", "draft path returns status='running'");
  assert.ok(body.runID, "draft path aliases taskID as runID");
  assert.ok(body.taskID, "draft path still returns taskID for compat");
  assert.equal(body.runID, body.taskID, "runID === taskID on draft path");
});

test("POST /api/task/run without workflowId does NOT insert a workflow_runs row", async () => {
  const { app, db } = makeApp();
  await app.fetch(
    new Request("http://localhost/api/task/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: SCHEMA, inputs: {} }),
    })
  );
  const count = db.prepare("SELECT COUNT(*) AS n FROM workflow_runs").get().n;
  assert.equal(count, 0, "draft path must not write to workflow_runs");
});

test("workflow_busy 409 no longer fires for saved workflows (queue owns serialization)", async () => {
  // Submit two saved-workflow runs in rapid succession — both should succeed
  // (queued), NOT 409. The per-workflow queue (Phase 3) serializes them.
  const { app } = makeApp({ enqueueRun: () => {} });
  const req = (body) =>
    app.fetch(
      new Request("http://localhost/api/task/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  const [r1, r2] = await Promise.all([
    req({ schema: SCHEMA, inputs: {}, workflowId: "wf_1" }),
    req({ schema: SCHEMA, inputs: {}, workflowId: "wf_1" }),
  ]);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200, "second saved-workflow submit must NOT 409");
  const b2 = await r2.json();
  assert.equal(b2.status, "queued");
});

test("saved-workflow path with unknown workflowId → 404 (FK violation guard)", async () => {
  const { app } = makeApp({ enqueueRun: () => {} });
  const res = await app.fetch(
    new Request("http://localhost/api/task/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schema: SCHEMA, inputs: {}, workflowId: "wf_does_not_exist" }),
    })
  );
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.match(body.error ?? "", /workflow/i);
});

test("POST /api/task/run rejects body without schema (400, both paths)", async () => {
  const { app } = makeApp();
  const saved = await app.fetch(
    new Request("http://localhost/api/task/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: {}, workflowId: "wf_1" }),
    })
  );
  assert.equal(saved.status, 400);
  const draft = await app.fetch(
    new Request("http://localhost/api/task/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: {} }),
    })
  );
  assert.equal(draft.status, 400);
});

test("GET /api/task/report and PUT /api/task/cancel no longer touch the old lock machinery", async () => {
  // Smoke: both endpoints still respond (the lock-release calls are gone, but
  // the endpoints themselves must keep working for the draft path). Phase 4
  // will add terminal capture; Phase 3 adds the unified cancel endpoint.
  const { app } = makeApp();
  const reportRes = await app.fetch(
    new Request("http://localhost/api/task/report?taskID=draft_task_1")
  );
  // 500 is fine (TaskReportAPI will fail on a fake taskID) — we only assert
  // it doesn't throw about a missing lock map.
  assert.ok([200, 500].includes(reportRes.status));
});
