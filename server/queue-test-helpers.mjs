/**
 * Phase 3 (#155): shared test fakes for the queue module + wiring tests.
 *
 * Extracted from queue.test.mjs and queue-wiring.test.mjs to avoid duplicated
 * code (the same makeFakeRunTask / makeFakeCancelTask shape was copied verbatim
 * between the two test files).
 */

/**
 * A fake runTask that returns {taskID, done} synchronously. `done` resolves
 * immediately with {status:'success'} unless `block(runID)` was called before
 * enqueue. `block(runID)` marks the run as blocking and returns a resolve
 * function; call that function (after enqueue) to settle `done`.
 *
 * #179: captures the `onProgress` callback passed by the queue so tests can
 * fire intermediate IReports via `emitProgress(runID, report)`. The callback
 * is stored per-runID; calling emitProgress invokes it synchronously (the
 * real pollUntilTerminal is async, but the queue's onProgress logic is sync
 * — caching + broadcast — so sync invocation tests the exact same path).
 */
export function makeFakeRunTask() {
  const calls = [];
  let counter = 0;
  const resolvers = new Map(); // runID → resolve fn (set inside runTask)
  const progressCallbacks = new Map(); // runID → onProgress fn (#179)
  const shouldBlock = new Set(); // runIDs marked blocking via block()
  const runTask = (workflowId, runID, payload, onProgress) => {
    const taskID = `task_${++counter}`;
    calls.push({ workflowId, runID, payload, taskID });
    if (typeof onProgress === "function") progressCallbacks.set(runID, onProgress);
    const done = shouldBlock.has(runID)
      ? new Promise((res) => resolvers.set(runID, res))
      : Promise.resolve({ status: "success" });
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
    /** #179: fire an intermediate IReport to the queue's onProgress callback. */
    emitProgress(runID, report) {
      const cb = progressCallbacks.get(runID);
      if (cb) cb(report);
    },
  };
}

/**
 * A fake cancelTask that records the taskIDs it was asked to cancel.
 * Always returns {success:true} (best-effort cancel succeeded).
 */
export function makeFakeCancelTask() {
  const cancelled = [];
  const cancelTask = async ({ taskID }) => {
    cancelled.push(taskID);
    return { success: true };
  };
  return { cancelTask, cancelled };
}
