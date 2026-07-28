import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { createApp } from "./app.mjs";
import { ensureSchema } from "./db-schema.mjs";
import { createRunsEventBus } from "./runs-events.mjs";

/**
 * Phase 6 (#158): delete-workflow active-run defense + workflow_deleted broadcast.
 *
 * Pins:
 *   - DELETE /api/workflows/:id returns 409 {error:'workflow_has_active_runs',
 *     activeCount} when the workflow has any queued or running runs.
 *   - After all active runs become terminal, DELETE succeeds with 200 {ok:true}
 *     and the cascade removes all workflow_runs rows for that workflow.
 *   - On a successful delete, bus.broadcastAll is called once with
 *     {type:'workflow_deleted', workflowId: <id>}.
 *   - DELETE on a workflow with only terminal runs (succeeded/failed/terminated)
 *     succeeds (no 409).
 *   - DELETE on a missing workflow still returns 404 (unchanged).
 *   - DELETE on a workflow with no runs at all returns 200 (no 409).
 */

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "wf-phase6-"));
  const db = new Database(join(dir, "workflow.db"));
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  db.prepare(
    "INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', ?)"
  ).run(JSON.stringify({ nodes: [], edges: [] }));
  return { db, dir };
}

function makeApp({ broadcastAll } = {}) {
  const { db, dir } = setupDb();
  const eventBus = createRunsEventBus();
  if (broadcastAll) {
    eventBus.broadcastAll = broadcastAll;
  }
  const app = createApp({ db, agentDir: dir, eventBus });
  return { app, db, dir, eventBus };
}

function insertRun(db, id, workflowId, status) {
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, ?, datetime('now'))"
  ).run(id, workflowId, status);
}

// --- 409 active-run defense ---

test("DELETE /workflows/:id returns 409 with activeCount when a queued run exists", async () => {
  const { app, db } = makeApp();
  insertRun(db, "run_q1", "wf_1", "queued");

  const res = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, "workflow_has_active_runs");
  assert.equal(body.activeCount, 1);
  // Workflow row must still exist (delete was refused).
  const wf = db.prepare("SELECT id FROM workflows WHERE id=?").get("wf_1");
  assert.ok(wf, "workflow row preserved on 409");
});

test("DELETE /workflows/:id returns 409 when a running run exists", async () => {
  const { app, db } = makeApp();
  insertRun(db, "run_r1", "wf_1", "running");

  const res = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, "workflow_has_active_runs");
  assert.equal(body.activeCount, 1);
});

test("DELETE /workflows/:id returns 409 with activeCount=2 when both queued and running exist", async () => {
  const { app, db } = makeApp();
  insertRun(db, "run_q1", "wf_1", "queued");
  insertRun(db, "run_r1", "wf_1", "running");

  const res = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.activeCount, 2);
});

test("DELETE /workflows/:id succeeds when all runs are terminal (succeeded/failed/terminated)", async () => {
  const { app, db } = makeApp();
  insertRun(db, "run_s1", "wf_1", "succeeded");
  insertRun(db, "run_f1", "wf_1", "failed");
  insertRun(db, "run_t1", "wf_1", "terminated");

  const res = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // Cascade removed all workflow_runs rows.
  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id=?")
    .get("wf_1").n;
  assert.equal(remaining, 0);
});

test("DELETE /workflows/:id succeeds when workflow has no runs at all", async () => {
  const { app } = makeApp();

  const res = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res.status, 200);
});

test("DELETE /workflows/:id on missing workflow still returns 404", async () => {
  const { app } = makeApp();

  const res = await app.fetch(
    new Request("http://localhost/workflows/does_not_exist", {
      method: "DELETE",
    })
  );
  assert.equal(res.status, 404);
});

// --- Active-then-terminal transition ---

test("DELETE /workflows/:id returns 409 while queued; succeeds after the run becomes terminated", async () => {
  const { app, db } = makeApp();
  insertRun(db, "run_q1", "wf_1", "queued");

  const res1 = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res1.status, 409);

  // The queued run is cancelled → terminal.
  db.prepare("UPDATE workflow_runs SET status='terminated' WHERE id=?").run(
    "run_q1"
  );

  const res2 = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res2.status, 200);
  const body = await res2.json();
  assert.equal(body.ok, true);
  // Cascade removed the (now terminal) run row.
  const remaining = db
    .prepare("SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id=?")
    .get("wf_1").n;
  assert.equal(remaining, 0);
});

// --- workflow_deleted broadcast ---

test("DELETE /workflows/:id broadcasts workflow_deleted via bus.broadcastAll on success", async () => {
  const calls = [];
  const { app } = makeApp({
    broadcastAll: (event) => calls.push(event),
  });

  const res = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    type: "workflow_deleted",
    workflowId: "wf_1",
  });
});

test("DELETE /workflows/:id does NOT broadcast workflow_deleted on 409 refusal", async () => {
  const calls = [];
  const { app, db } = makeApp({
    broadcastAll: (event) => calls.push(event),
  });
  insertRun(db, "run_q1", "wf_1", "queued");

  const res = await app.fetch(
    new Request("http://localhost/workflows/wf_1", { method: "DELETE" })
  );
  assert.equal(res.status, 409);
  assert.equal(calls.length, 0);
});

test("DELETE /workflows/:id does NOT broadcast workflow_deleted on 404 (missing workflow)", async () => {
  const calls = [];
  const { app } = makeApp({
    broadcastAll: (event) => calls.push(event),
  });

  const res = await app.fetch(
    new Request("http://localhost/workflows/does_not_exist", {
      method: "DELETE",
    })
  );
  assert.equal(res.status, 404);
  assert.equal(calls.length, 0);
});
