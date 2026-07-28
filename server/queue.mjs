/**
 * Phase 3 (#155): per-workflow serial run queue.
 *
 * In-memory `Map<workflowId, {current, queue[]}>` + FIFO scheduler. Three
 * trigger points (per #142):
 *   - enqueue: push onto queue; if `current` is null, dequeue immediately.
 *   - onTerminal (called when runTask resolves/rejects): clear `current`,
 *     then dequeue the next if any.
 *   - cancelQueued: remove a queued run without advancing (only
 *     dequeue/onTerminal advance — cancelling a queued run does NOT start
 *     the next, because the next wasn't at the head until current finishes).
 *
 * Wall-clock 30min zombie-run guard: a setInterval scans `current` entries;
 * if `now - startedAt > wallClockMs`, force-call onTerminal with
 * {status:'failed', reason:'wall_clock_zombie'} and cancelTask (best-effort).
 * This catches runs where runTask neither resolves nor rejects (stuck
 * provider, hung agent session).
 *
 * Pure module (factory) — no HTTP, no TaskRunAPI import. The caller injects
 * `runTask`/`cancelTask`/`onTerminal` so this is unit-testable with fakes.
 * Phase 4 will own terminal capture into workflow_runs.report (the `onTerminal`
 * callback this module invokes is where Phase 4 writes the row).
 *
 * Decisions pinned:
 *   - #142: per-workflow FIFO, 3 trigger points, wall-clock 30min, no
 *     cross-workflow global queue.
 *   - #66/#78: signal.aborted precedence is Phase 4's concern (terminal
 *     classification); this module just forwards runTask's result/error.
 *   - Server-restart auto-recovery is out of scope (Phase 1 marks in-flight
 *     rows terminated on startup).
 */

const DEFAULT_WALL_CLOCK_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

/**
 * @param {object} deps
 * @param {import("better-sqlite3").Database} deps.db
 * @param {(workflowId: string, runID: string, payload: {schema: string, inputs: object}) => Promise<{taskID: string, done: Promise<{status: string, reason?: string}>}> | {taskID: string, done: Promise<{status: string, reason?: string}>}} deps.runTask
 *   Starts the run (calls TaskRunAPI in prod) and returns `{taskID, done}`.
 *   May be sync or async — `dequeue` awaits it. `taskID` is captured after
 *   the await so the wall-clock guard and cancel can target it. `done`
 *   resolves with the terminal result; rejects on error.
 * @param {({taskID: string}) => Promise<{success: boolean}>} deps.cancelTask
 *   Best-effort cancel of a running task (calls TaskCancelAPI in prod).
 * @param {(runID: string, result: {status: string, reason?: string, taskID?: string}) => void} deps.onTerminal
 *   Called once per run when it reaches a terminal state. Phase 4 writes the
 *   row here.
 * @param {(workflowId: string, event: object) => void} [deps.onEvent]
 *   Phase 5: optional callback fired on every run state transition so the
 *   caller (index.mjs) can broadcast SSE events. Events:
 *     - {type:'run_status', runID, status:'queued', queued_at}
 *     - {type:'run_status', runID, status:'running', started_at}
 *     - {type:'run_status', runID, status:'terminated'} (cancelQueued)
 *   The terminal event ({type:'run_terminal', ...}) is fired by the adapter's
 *   onTerminal hook (after the DB row is written), NOT here — because the
 *   terminal broadcast needs the full report + schema_snapshot which only the
 *   adapter has access to.
 * @param {number} [deps.wallClockMs=30*60*1000] - zombie-run threshold.
 * @param {number} [deps.sweepIntervalMs=60*1000] - how often the wall-clock
 *   guard scans.
 * @param {() => number} [deps.now=Date.now] - injectable clock for tests.
 * @returns {{
 *   enqueue: (workflowId: string, runID: string, payload: {schema: string, inputs: object}) => void,
 *   cancelQueued: (runID: string) => boolean,
 *   getRunningTaskID: (runID: string) => string | null,
 *   getQueuePosition: (workflowId: string, runID: string) => number,
 *   isActive: () => boolean,
 *   activeRunCount: (workflowId: string) => number,
 *   dispose: () => void,
 * }}
 */
export function createRunQueue({
  db,
  runTask,
  cancelTask,
  onTerminal,
  onEvent,
  wallClockMs = DEFAULT_WALL_CLOCK_MS,
  sweepIntervalMs = DEFAULT_SWEEP_INTERVAL_MS,
  now = Date.now,
}) {
  // Map<workflowId, {current: {runID, taskID, startedAt, payload, done} | null, queue: [{runID, payload}]}>
  const workflows = new Map();

  function getWf(workflowId) {
    let wf = workflows.get(workflowId);
    if (!wf) {
      wf = { current: null, queue: [] };
      workflows.set(workflowId, wf);
    }
    return wf;
  }

  const updateRunning = db.prepare(
    "UPDATE workflow_runs SET status='running', started_at=datetime('now') WHERE id=?"
  );
  const updateTaskID = db.prepare(
    "UPDATE workflow_runs SET task_id=? WHERE id=? AND task_id IS NULL"
  );
  // Phase 5: read the timestamps back for the SSE broadcast. The queue writes
  // them with datetime('now') (SQLite server time) so reading them back keeps
  // the broadcast consistent with what GET /api/runs/:runID returns.
  const getRunTimestamps = db.prepare(
    "SELECT queued_at, started_at FROM workflow_runs WHERE id=?"
  );
  // cancelQueued's UPDATE is scoped to status='queued' only — NOT the broader
  // "NOT IN (succeeded,failed,terminated)" guard. The broader guard would
  // clobber a row that already transitioned to 'running' during the queued→running
  // race window (dequeue sets status='running' before cancelQueued runs if the
  // queue advanced). The endpoint's re-read handles that race at the API layer,
  // but the queue method must also be safe in isolation.
  const updateTerminatedFromQueued = db.prepare(
    "UPDATE workflow_runs SET status='terminated', ended_at=datetime('now') WHERE id=? AND status='queued'"
  );

  /**
   * Mark `current` terminal and, if there's a queued run, dequeue it. Called
   * from both normal runTask completion and the wall-clock guard.
   *
   * Phase 4: onTerminal may be async (fetches TaskReport + writes DB). The
   * queue does NOT await it — if it did, a slow TaskReport fetch would block
   * the next dequeue. Instead, onTerminal's own try/catch swallows errors,
   * and we attach a .catch() here as a backstop so an async rejection can't
   * become an unhandledRejection. The queue advances immediately.
   */
  function finishCurrent(workflowId, result) {
    const wf = workflows.get(workflowId);
    if (!wf || !wf.current) return;
    const runID = wf.current.runID;
    wf.current = null;
    // Notify the caller (Phase 4 writes workflow_runs.report here).
    try {
      const ret = onTerminal(runID, result);
      // If onTerminal returned a promise (async), attach a backstop catch so
      // a rejection can't become unhandledRejection. The adapter's own
      // try/catch is the primary defense; this is the safety net.
      if (ret && typeof ret.catch === "function") {
        ret.catch((err) => {
          console.error("[queue] onTerminal async rejection for run", runID, err);
        });
      }
    } catch (err) {
      // Sync throw — log and continue (don't stall the queue).
      console.error("[queue] onTerminal threw for run", runID, err);
    }
    // Advance to the next queued run, if any.
    if (wf.queue.length > 0) {
      dequeue(workflowId);
    } else if (wf.current === null) {
      // No current and empty queue — drop the workflow entry to avoid leak.
      workflows.delete(workflowId);
    }
  }

  /**
   * Shift the queue head, set it as current, UPDATE the DB row to running,
   * and kick off runTask. runTask may be sync or async — `dequeue` awaits it
   * (the first `current` is already set before the await so a rapid re-enqueue
   * sees the workflow as busy). `taskID` (returned by runTask) is written to
   * the DB once available so the cancel endpoint can look it up.
   */
  async function dequeue(workflowId) {
    const wf = getWf(workflowId);
    if (wf.current) return; // already running — cannot dequeue
    if (wf.queue.length === 0) return;
    const { runID, payload } = wf.queue.shift();
    // Set a placeholder current BEFORE the await so concurrent enqueues see
    // the workflow as busy (otherwise two rapid enqueues could both dequeue).
    wf.current = { runID, taskID: null, startedAt: now(), payload };
    updateRunning.run(runID);
    // Phase 5: fire run_status=running. Done after the DB write so a
    // concurrent GET /api/runs/:runID sees the new status. started_at was
    // just written by updateRunning; read it back for broadcast consistency.
    if (typeof onEvent === "function") {
      const ts = getRunTimestamps.get(runID);
      onEvent(workflowId, {
        type: "run_status",
        runID,
        status: "running",
        started_at: ts?.started_at ?? null,
      });
    }

    let started;
    try {
      started = await runTask(workflowId, runID, payload);
    } catch (err) {
      // runTask threw (e.g. bad schema) — treat as failed. Guard: another
      // dequeue or wall-clock sweep may have already cleared `current` while
      // we were awaiting (e.g. the wall-clock guard force-failed it). Only
      // finish if current is still our runID.
      const cur = workflows.get(workflowId)?.current;
      if (!cur || cur.runID !== runID) return;
      finishCurrent(workflowId, {
        status: "failed",
        reason: err?.message ?? "run_start_error",
      });
      return;
    }
    // Guard: a wall-clock sweep during the await may have already advanced.
    const cur = workflows.get(workflowId)?.current;
    if (!cur || cur.runID !== runID) return;
    cur.taskID = started.taskID ?? null;
    if (started.taskID) {
      updateTaskID.run(started.taskID, runID);
    }

    // Await terminal. Use .then/.catch (not await) so dequeue stays async but
    // doesn't block the next dequeue. The runID guard prevents double-firing:
    // if the wall-clock guard already force-failed this run (clearing
    // `current` and advancing the queue), a late `done` settlement must NOT
    // clear the next run's `current`.
    started.done.then(
      (result) => {
        const w = workflows.get(workflowId);
        if (!w || !w.current || w.current.runID !== runID) return;
        // Phase 4: attach taskID so onTerminal can fetch the TaskReport.
        finishCurrent(workflowId, {
          ...(result ?? { status: "success" }),
          taskID: w.current.taskID ?? started.taskID,
        });
      },
      (err) => {
        const w = workflows.get(workflowId);
        if (!w || !w.current || w.current.runID !== runID) return;
        // Phase 4 (#156 spec): AgentExecutionError.kind (agent_not_found /
        // provider_error / internal_error) is the structured reason the spec
        // asks for; fall back to message for non-AgentExecutionError throws.
        const reason = err?.kind ?? err?.message ?? "run_error";
        finishCurrent(workflowId, {
          status: "failed",
          reason,
          taskID: w.current.taskID ?? started.taskID,
        });
      }
    );
  }

  function enqueue(workflowId, runID, payload) {
    const wf = getWf(workflowId);
    wf.queue.push({ runID, payload });
    // Phase 5: fire run_status=queued so the SSE bus broadcasts it. Done
    // before dequeue() so subscribers see queued → running in order (the
    // dequeue broadcast fires synchronously inside dequeue if no current).
    // queued_at was written by POST /api/task/run; read it back so the
    // broadcast matches what GET /api/runs/:runID returns.
    if (typeof onEvent === "function") {
      const ts = getRunTimestamps.get(runID);
      onEvent(workflowId, {
        type: "run_status",
        runID,
        status: "queued",
        queued_at: ts?.queued_at ?? null,
      });
    }
    if (!wf.current) {
      dequeue(workflowId);
    }
  }

  /**
   * Remove a queued run and mark it terminated. Does NOT advance the queue —
   * only finishCurrent (triggered by the running task's terminal) advances.
   * Returns true if the run was queued and removed; false if it was running,
   * terminal, or not found.
   *
   * Race-safe: the UPDATE is scoped to status='queued' only. If the run
   * transitioned to 'running' between the in-memory find and the DB write
   * (dequeue advanced), the UPDATE affects 0 rows and we return false —
   * letting the caller route to the running-cancel path instead.
   */
  function cancelQueued(runID) {
    for (const [workflowId, wf] of workflows) {
      const idx = wf.queue.findIndex((r) => r.runID === runID);
      if (idx >= 0) {
        wf.queue.splice(idx, 1);
        const result = updateTerminatedFromQueued.run(runID);
        // If the row already transitioned to 'running' (race), the UPDATE
        // affected 0 rows — treat as "not queued anymore" so the endpoint
        // falls through to the running-cancel path.
        if (result.changes === 0) {
          // Still clean up the in-memory queue entry (already spliced above)
          // but report false so the caller knows the DB wasn't terminated.
          if (!wf.current && wf.queue.length === 0) workflows.delete(workflowId);
          return false;
        }
        // Phase 5: fire run_status=terminated (cancelQueued path). The
        // terminal broadcast (with full report) is NOT fired here because
        // cancelQueued only writes status + ended_at — there's no TaskReport
        // to attach (the run never started).
        if (typeof onEvent === "function") {
          onEvent(workflowId, { type: "run_status", runID, status: "terminated" });
        }
        // If the queue is now empty AND no current, drop the wf entry.
        if (!wf.current && wf.queue.length === 0) workflows.delete(workflowId);
        return true;
      }
    }
    return false;
  }

  /** The taskID of a currently-running run (for the cancel endpoint). */
  function getRunningTaskID(runID) {
    for (const wf of workflows.values()) {
      if (wf.current?.runID === runID) return wf.current.taskID;
    }
    return null;
  }

  /**
   * 1-based position in the queue (1 = next to run). 0 if running, terminal,
   * or not found. Used by the Test Run panel to show "Queued, position N".
   */
  function getQueuePosition(workflowId, runID) {
    const wf = workflows.get(workflowId);
    if (!wf) return 0;
    const idx = wf.queue.findIndex((r) => r.runID === runID);
    return idx >= 0 ? idx + 1 : 0;
  }

  /**
   * Count of active runs (running + queued) for a single workflow. Phase 6
   * uses this in the delete-workflow guard to refuse deletion while a
   * workflow has in-flight runs. Exposed now (with a test) so Phase 6's
   * wiring is a one-line call — not a queue.mjs edit.
   */
  function activeRunCount(workflowId) {
    const wf = workflows.get(workflowId);
    if (!wf) return 0;
    return (wf.current ? 1 : 0) + wf.queue.length;
  }

  /**
   * True if ANY workflow has an active run (running or queued). Phase 6's
   * delete-workflow guard uses this to short-circuit the "is anything
   * running anywhere?" check before per-workflow lookup. Same rationale as
   * activeRunCount — exposed + tested now, consumed in Phase 6.
   */
  function isActive() {
    for (const wf of workflows.values()) {
      if (wf.current || wf.queue.length > 0) return true;
    }
    return false;
  }

  // --- Wall-clock zombie guard ---
  // Scans `current` entries every sweepIntervalMs; if a run has been
  // in-flight longer than wallClockMs, force-fails it and best-effort cancels
  // the underlying task. This is the ONLY way to recover a run whose `done`
  // promise never settles (hung provider, stuck agent session).
  const sweepTimer = setInterval(() => {
    const t = now();
    for (const [workflowId, wf] of workflows) {
      if (!wf.current) continue;
      if (t - wf.current.startedAt >= wallClockMs) {
        const zombie = wf.current;
        // Best-effort cancel the underlying task — cancelTask is fire-and-forget
        // here (we don't await; the finishCurrent below advances the queue
        // regardless of whether cancelTask succeeds).
        if (zombie.taskID) {
          Promise.resolve()
            .then(() => cancelTask({ taskID: zombie.taskID }))
            .catch(() => {});
        }
        // Phase 4: attach taskID so onTerminal can fetch the (possibly stale)
        // TaskReport before writing the terminal row.
        finishCurrent(workflowId, {
          status: "failed",
          reason: "wall_clock_zombie",
          taskID: zombie.taskID,
        });
      }
    }
  }, sweepIntervalMs);
  sweepTimer.unref?.();

  function dispose() {
    clearInterval(sweepTimer);
    workflows.clear();
  }

  return {
    enqueue,
    cancelQueued,
    getRunningTaskID,
    getQueuePosition,
    isActive,
    activeRunCount,
    dispose,
  };
}
