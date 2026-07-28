/**
 * Phase 3 (#155): prod queue adapter.
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
 * `onTerminal` is a minimal Phase 3 stub: it updates the workflow_runs row's
 * status + ended_at based on the terminal result. Phase 4 will replace this
 * with full TaskReport capture (report JSON, schema_snapshot, etc.).
 *
 * Decisions pinned:
 *   - #144: unified cancel — queued runs via queue.cancelQueued, running runs
 *     via TaskCancelAPI (through queue.getRunningTaskID → cancelTask).
 *   - #142: wall-clock 30min zombie guard lives in queue.mjs; this adapter
 *     just provides the prod bindings.
 *   - Phase 4 owns terminal capture — onTerminal here only writes status +
 *     ended_at (minimal). The full TaskReport is written in Phase 4.
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
 * @param {import("better-sqlite3").Database} db
 * @returns {{runTask: Function, cancelTask: Function, onTerminal: Function}}
 *   The three callbacks for createRunQueue. Inject these into the factory.
 */
export function createQueueAdapter(db) {
  // Prepared statements for the minimal Phase 3 onTerminal (status + ended_at).
  // Phase 4 will extend onTerminal to write the full report JSON + schema_snapshot.
  const updateSucceeded = db.prepare(
    "UPDATE workflow_runs SET status='succeeded', ended_at=datetime('now') WHERE id=? AND status NOT IN ('succeeded','failed','terminated')"
  );
  const updateFailed = db.prepare(
    "UPDATE workflow_runs SET status='failed', ended_at=datetime('now') WHERE id=? AND status NOT IN ('succeeded','failed','terminated')"
  );
  const updateTerminated = db.prepare(
    "UPDATE workflow_runs SET status='terminated', ended_at=datetime('now') WHERE id=? AND status NOT IN ('succeeded','failed','terminated')"
  );

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
     * Minimal Phase 3 onTerminal: write status + ended_at. Phase 4 replaces
     * this with full report capture (report JSON, schema_snapshot).
     */
    onTerminal(runID, result) {
      try {
        if (result.status === "succeeded") {
          updateSucceeded.run(runID);
        } else if (result.status === "failed") {
          updateFailed.run(runID);
        } else {
          // terminated (cancelled / interrupted / wall_clock_zombie)
          updateTerminated.run(runID);
        }
      } catch (err) {
        // Defensive: onTerminal must never throw into the queue loop (the
        // queue wraps it in try/catch too, but log here for visibility).
        console.error("[queue-adapter] onTerminal DB write failed for run", runID, err);
      }
    },
  };
}
