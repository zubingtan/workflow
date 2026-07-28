/**
 * Phase 3 (#155) + Phase 4 (#156): prod queue adapter.
 *
 * Bridges the pure `createRunQueue` factory (server/queue.mjs) to the FlowGram
 * Task APIs (TaskRunAPI / TaskReportAPI / TaskCancelAPI). The queue module
 * itself is pi-free and runtime-free — this adapter is where the real
 * TaskRunAPI is called.
 *
 * `runTask` contract (per queue.mjs):
 *   Returns {taskID, done}. `taskID` is available after TaskRunAPI resolves
 *   (fast — it just starts the run). `done` settles when the run reaches a
 *   terminal state (observed by polling TaskReportAPI until terminated).
 *
 * `cancelTask` wraps TaskCancelAPI (best-effort).
 *
 * `onTerminal` (Phase 4): captures the full terminal snapshot into
 *   workflow_runs — status + report (JSON TaskReport) + schema_snapshot
 *   (JSON workflow data) + ended_at, in ONE UPDATE. Idempotent (WHERE
 *   status NOT IN ('succeeded','failed','terminated') prevents clobbering).
 *   Write failures are swallowed (try/catch) — never crash the queue loop.
 *
 * Decisions pinned:
 *   - #144: unified cancel — queued runs via queue.cancelQueued, running runs
 *     via TaskCancelAPI (through queue.getRunningTaskID → cancelTask).
 *   - #142: wall-clock 30min zombie guard lives in queue.mjs; this adapter
 *     just provides the prod bindings.
 *   - #145: terminal capture — onTerminal fetches the TaskReport + workflow
 *     schema and writes them to workflow_runs. The poll route
 *     (GET /api/task/report) stays for the Test Run panel and does NOT write.
 *   - #66/#78: signal.aborted precedence — already resolved in
 *     classifyTerminal (cancelled/interrupted → terminated).
 */
import { TaskRunAPI, TaskReportAPI, TaskCancelAPI } from "./runtime-adapter.mjs";

const REPORT_POLL_INTERVAL_MS = 500;

/**
 * Map a FlowGram TaskReport's workflowStatus to the queue's terminal result
 * shape ({status, reason?}). The queue passes this to onTerminal.
 *
 * FlowGram StatusData (runtime-interface/dist/index.d.ts):
 *   { status: "pending"|"processing"|"succeeded"|"failed"|"canceled",
 *     terminated: boolean, startTime, endTime?, timeCost }
 * The queue's terminal statuses are the #141 merged set:
 * succeeded | failed | terminated (canceled → terminated).
 */
function classifyTerminal(report) {
  const s = report?.workflowStatus ?? {};
  // StatusData.status is the string enum; StatusData.terminated is the boolean
  // "workflow is done" flag. We prefer the string for classification, but fall
  // back to terminated=true + messages for defensive handling.
  if (s.status === "succeeded") return { status: "succeeded" };
  if (s.status === "canceled") return { status: "terminated", reason: "cancelled" };
  if (s.status === "failed") {
    const reason = report?.messages?.error?.[0]?.message ?? "failed";
    return { status: "failed", reason };
  }
  // Defensive: if workflowStatus.terminated is true but status isn't one of the
  // known terminal values, treat as failed (shouldn't happen — poll loop only
  // resolves when terminated=true).
  if (s.terminated) return { status: "failed", reason: "unknown_terminal" };
  return { status: "failed", reason: "unknown_terminal" };
}

/**
 * Poll TaskReportAPI until the run reaches a terminal state, then resolve
 * with the classified terminal result AND the full TaskReport. Rejects if
 * TaskReportAPI errors.
 *
 * The full report is included so `onTerminal` can write it to the DB without
 * re-fetching — the runtime may GC the in-memory task between poll and
 * onTerminal (observed in E2E: `app.report(taskID)` returns undefined after
 * the task finishes, even though the task is still in the tasks Map). By
 * carrying the report forward from the poll that detected termination, we
 * avoid the second fetch entirely.
 *
 * This mirrors the browser's syncTaskReport loop (runtime-service/index.ts)
 * but server-side — the browser polls to update the Test Run panel; the
 * server polls to observe terminal for the queue's onTerminal callback.
 */
function pollUntilTerminal(taskID) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const report = await TaskReportAPI({ taskID });
        if (!report) {
          clearInterval(interval);
          reject(new Error("TaskReportAPI returned null"));
          return;
        }
        // StatusData.terminated is true once the workflow reaches a terminal
        // state (succeeded/failed/canceled). Polling until terminated=true
        // mirrors the browser's syncTaskReport (runtime-service/index.ts:270).
        const s = report.workflowStatus ?? {};
        if (s.terminated) {
          clearInterval(interval);
          // Carry the full report so onTerminal doesn't need to re-fetch
          // (the runtime may have GC'd it by the time onTerminal runs).
          resolve({ ...classifyTerminal(report), _report: report });
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, REPORT_POLL_INTERVAL_MS);
  });
}

/**
 * Phase 4 (#156) + Phase 5 (#157): build the capturing onTerminal callback.
 *
 * Extracted from `createQueueAdapter` so host-side tests can inject a fake
 * `fetchTaskReport` (bypassing the real `TaskReportAPI` import) while
 * exercising the EXACT same SQL + merge logic as prod. This avoids
 * duplicating the capture logic between the adapter and the test helper.
 *
 * Phase 5: optional `eventBus` — if provided, the callback broadcasts a
 * `run_terminal` event (with the full report + schema_snapshot) AFTER the
 * DB row is written. The broadcast needs the workflowId (looked up from the
 * run row) so it goes to the right subscribers.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {(taskID: string) => Promise<object|null>} [fetchTaskReport]
 *   Defaults to the real `TaskReportAPI`. Tests inject a fake.
 * @param {object} [eventBus] - Phase 5 SSE bus. If absent, no broadcast.
 * @returns {(runID: string, result: {status: string, reason?: string, taskID?: string}) => Promise<void>}
 */
export function createCapturingOnTerminal(db, fetchTaskReport = TaskReportAPI, eventBus) {
  // Phase 4: single UPDATE captures status + report + schema_snapshot + ended_at.
  // Idempotent: WHERE status NOT IN (...) prevents clobbering a terminal row
  // if onTerminal is somehow called twice (defensive — the queue's runID guard
  // already prevents this, but the DB guard is the backstop).
  const updateTerminal = db.prepare(
    `UPDATE workflow_runs
       SET status=@status, report=@report, schema_snapshot=@schema_snapshot, ended_at=datetime('now')
     WHERE id=@id AND status NOT IN ('succeeded','failed','terminated')`
  );
  // Look up the workflow_id + ended_at for a run. ended_at is read AFTER the
  // UPDATE (which sets ended_at=datetime('now')) so the broadcast's ended_at
  // matches what GET /api/runs/:runID returns — avoids drift between the
  // SQL server time and a JS new Date().toISOString().
  const getRunWorkflowId = db.prepare(
    "SELECT workflow_id, ended_at FROM workflow_runs WHERE id=?"
  );
  // Fetch the workflow data (terminal-time schema snapshot for Phase 8 readonly viewer).
  const getWorkflowData = db.prepare("SELECT data FROM workflows WHERE id=?");

  return async function onTerminal(runID, result) {
    try {
      const status = result.status; // succeeded | failed | terminated

      // --- Obtain the terminal TaskReport ---
      // Phase 10 (#162): prefer the report carried forward from
      // pollUntilTerminal (result._report) — the runtime may return undefined
      // from a second fetch (observed in E2E: app.report(taskID) returns
      // undefined after the task finishes, even though the task object is
      // still in the tasks Map). Fall back to fetchTaskReport only if the
      // carried report is absent (e.g. wall-clock zombie path where
      // pollUntilTerminal didn't resolve).
      let reportJson = null;
      let report = result._report ?? null;
      if (!report && result.taskID) {
        try {
          report = await fetchTaskReport(result.taskID);
        } catch {
          // TaskReport fetch failed — write a minimal report with the reason.
          if (result.reason) {
            reportJson = JSON.stringify({ reason: result.reason });
          }
          report = null;
        }
      }
      if (report) {
        // Merge the queue's classification reason into the report JSON
        // (e.g. wall_clock_zombie, run_error, cancelled) so the history
        // viewer can show why the run ended up in this state.
        const merged = { ...report };
        if (result.reason) merged.reason = result.reason;
        reportJson = JSON.stringify(merged);
      } else if (result.reason) {
        // No TaskReport but we have a reason — write a minimal report.
        reportJson = JSON.stringify({ reason: result.reason });
      }

      // --- Fetch the workflow schema snapshot (terminal-time workflow data) ---
      let schemaSnapshot = null;
      const runRow = getRunWorkflowId.get(runID);
      if (runRow) {
        const wfRow = getWorkflowData.get(runRow.workflow_id);
        if (wfRow) {
          schemaSnapshot = wfRow.data; // already JSON string in workflows.data
        }
      }

      // --- One idempotent UPDATE ---
      updateTerminal.run({
        id: runID,
        status,
        report: reportJson,
        schema_snapshot: schemaSnapshot,
      });

      // --- Phase 5: broadcast run_terminal to SSE subscribers ---
      // Fired AFTER the DB row is written so a concurrent GET /api/runs/:runID
      // returns the terminal state. The broadcast carries the full report +
      // schema_snapshot so the History Modal can render detail without a
      // follow-up fetch (though it MAY refetch to be safe). Wrapped in
      // try/catch so a bus failure can't crash onTerminal (which would leave
      // the DB row in its pre-terminal state).
      //
      // ended_at is re-read from the DB (the UPDATE set it via datetime('now'))
      // so the broadcast matches what GET /api/runs/:runID returns — using
      // new Date().toISOString() here would drift from the SQL server time.
      if (eventBus && runRow) {
        try {
          const after = getRunWorkflowId.get(runID);
          eventBus.broadcast(runRow.workflow_id, {
            type: "run_terminal",
            runID,
            status,
            report: reportJson ? JSON.parse(reportJson) : null,
            schema_snapshot: schemaSnapshot ? JSON.parse(schemaSnapshot) : null,
            ended_at: after?.ended_at ?? null,
          });
        } catch (broadcastErr) {
          console.error(
            "[queue-adapter] run_terminal broadcast failed for run",
            runID,
            broadcastErr
          );
        }
      }
    } catch (err) {
      // Defensive: onTerminal must never throw into the queue loop (the
      // queue wraps it in try/catch + .catch() backstop, but log here for
      // visibility). A failed DB write leaves the row in its pre-terminal
      // state (running) — Phase 1's restart sweep will mark it terminated
      // on next server start if this crash takes the process down.
      console.error(
        "[queue-adapter] onTerminal terminal capture failed for run",
        runID,
        err
      );
    }
  };
}

/**
 * @param {import("better-sqlite3").Database} db
 * @param {object} [eventBus] - Phase 5 SSE bus for run_terminal broadcasts.
 *   Optional — if absent, onTerminal still writes the DB row but doesn't broadcast.
 * @returns {{runTask: Function, cancelTask: Function, onTerminal: Function}}
 *   The three callbacks for createRunQueue. Inject these into the factory.
 */
export function createQueueAdapter(db, eventBus) {
  return {
    /**
     * Start a run via TaskRunAPI. Returns {taskID, done} — taskID is captured
     * synchronously (after TaskRunAPI resolves), done settles at terminal.
     */
    async runTask(workflowId, runID, payload) {
      const { schema, inputs } = payload;
      const result = await TaskRunAPI({ schema, inputs });
      const taskID = result?.taskID;
      if (!taskID) {
        throw new Error("TaskRunAPI returned no taskID");
      }
      // `done` settles when the run reaches a terminal state (poll-based).
      // The queue's wall-clock guard is the backstop if this never settles.
      const done = pollUntilTerminal(taskID);
      return { taskID, done };
    },

    /** Best-effort cancel via TaskCancelAPI. */
    async cancelTask({ taskID }) {
      return TaskCancelAPI({ taskID });
    },

    /**
     * Phase 4: capture the full terminal snapshot into workflow_runs.
     * Phase 5: broadcast run_terminal to SSE subscribers (if eventBus provided).
     * Delegates to `createCapturingOnTerminal` (shared with tests).
     */
    onTerminal: createCapturingOnTerminal(db, TaskReportAPI, eventBus),
  };
}
