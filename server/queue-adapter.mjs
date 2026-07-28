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
 * FlowGram statuses (runtime-interface): { running, success, failed, cancelled,
 * interrupted }. The queue's terminal statuses are the #141 merged set:
 * succeeded | failed | terminated (cancelled + interrupted → terminated).
 */
function classifyTerminal(report) {
  const s = report?.workflowStatus ?? {};
  if (s.success) return { status: "succeeded" };
  if (s.cancelled || s.interrupted) {
    return { status: "terminated", reason: s.cancelled ? "cancelled" : "interrupted" };
  }
  if (s.failed) {
    const reason = report?.messages?.error?.[0]?.message ?? "failed";
    return { status: "failed", reason };
  }
  // Defensive: if workflowStatus is not terminal but TaskReportAPI returned,
  // treat as failed (shouldn't happen — poll loop only resolves on terminal).
  return { status: "failed", reason: "unknown_terminal" };
}

/**
 * Poll TaskReportAPI until the run reaches a terminal state, then resolve
 * with the classified terminal result. Rejects if TaskReportAPI errors.
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
        const s = report.workflowStatus ?? {};
        if (s.success || s.failed || s.cancelled || s.interrupted) {
          clearInterval(interval);
          resolve(classifyTerminal(report));
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, REPORT_POLL_INTERVAL_MS);
  });
}

/**
 * Phase 4 (#156): build the capturing onTerminal callback.
 *
 * Extracted from `createQueueAdapter` so host-side tests can inject a fake
 * `fetchTaskReport` (bypassing the real `TaskReportAPI` import) while
 * exercising the EXACT same SQL + merge logic as prod. This avoids
 * duplicating the capture logic between the adapter and the test helper.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {(taskID: string) => Promise<object|null>} [fetchTaskReport]
 *   Defaults to the real `TaskReportAPI`. Tests inject a fake.
 * @returns {(runID: string, result: {status: string, reason?: string, taskID?: string}) => Promise<void>}
 */
export function createCapturingOnTerminal(db, fetchTaskReport = TaskReportAPI) {
  // Phase 4: single UPDATE captures status + report + schema_snapshot + ended_at.
  // Idempotent: WHERE status NOT IN (...) prevents clobbering a terminal row
  // if onTerminal is somehow called twice (defensive — the queue's runID guard
  // already prevents this, but the DB guard is the backstop).
  const updateTerminal = db.prepare(
    `UPDATE workflow_runs
       SET status=@status, report=@report, schema_snapshot=@schema_snapshot, ended_at=datetime('now')
     WHERE id=@id AND status NOT IN ('succeeded','failed','terminated')`
  );
  // Look up the workflow_id for a run (to fetch the workflow schema snapshot).
  const getRunWorkflowId = db.prepare(
    "SELECT workflow_id FROM workflow_runs WHERE id=?"
  );
  // Fetch the workflow data (terminal-time schema snapshot for Phase 8 readonly viewer).
  const getWorkflowData = db.prepare("SELECT data FROM workflows WHERE id=?");

  return async function onTerminal(runID, result) {
    try {
      const status = result.status; // succeeded | failed | terminated

      // --- Fetch the terminal TaskReport (if taskID available) ---
      let reportJson = null;
      if (result.taskID) {
        try {
          const report = await fetchTaskReport(result.taskID);
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
        } catch {
          // TaskReport fetch failed — write a minimal report with the reason.
          if (result.reason) {
            reportJson = JSON.stringify({ reason: result.reason });
          }
        }
      } else if (result.reason) {
        // No taskID (e.g. run_start_error before taskID was assigned) —
        // write a minimal report with just the reason.
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
 * @returns {{runTask: Function, cancelTask: Function, onTerminal: Function}}
 *   The three callbacks for createRunQueue. Inject these into the factory.
 */
export function createQueueAdapter(db) {
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
     * Delegates to `createCapturingOnTerminal` (shared with tests).
     */
    onTerminal: createCapturingOnTerminal(db),
  };
}
