/**
 * Phase 5 (#157): per-workflow SSE event bus for run status broadcasts.
 *
 * In-process event bus that fans out run lifecycle events to all subscribed
 * SSE connections for a given workflow. Multi-tab sync: each browser tab
 * opens its own EventSource, which calls `subscribe(workflowId, res)`.
 *
 * The bus is framework-agnostic — `res` is any object with a `write(chunk)`
 * method. In prod, the Hono endpoint wraps a ReadableStream controller into
 * a res-like object; in tests, a fake `res` with `.write` + `.setHeader`
 * exercises the bus directly.
 *
 * Events:
 *   - run_status: {type:'run_status', runID, status, queued_at?, started_at?}
 *       Broadcast on enqueue (queued), dequeue (running), cancelQueued (terminated).
 *   - run_progress: {type:'run_progress', runID, report: IReport}
 *       #179: broadcast on each server-side poll tick where per-node status or
 *       snapshot count changed. Carries the full intermediate IReport so
 *       clients can reuse their updateReport logic. NOT fired on the terminal
 *       tick — the terminal report is delivered via run_terminal. Source: the
 *       queue's onProgress callback (pollUntilTerminal → runTask → dequeue).
 *   - run_terminal: {type:'run_terminal', runID, status, report, schema_snapshot, ended_at}
 *       Broadcast from onTerminal after the DB row is written.
 *   - workflow_deleted: {type:'workflow_deleted', workflowId}
 *       Broadcast via broadcastAll when a workflow is deleted (Phase 6 wires
 *       this into DELETE /api/workflows/:id).
 *
 * Init frame (sent once on subscribe, not via broadcast):
 *   {type:'init', activeRunIDs: string[], activeRuns: Array<{runID, status, report}>}
 *   #179: `activeRuns` carries the latest intermediate IReport for each running
 *   run (via queue.getCurrentReport) so a late subscriber immediately sees the
 *   current per-node state. `activeRunIDs` is kept for backward-compat.
 *
 * Out of scope: cross-server broadcast (single-process only; no Redis).
 */

/** Format an event as an SSE `data:` frame (terminated by `\n\n`). */
function formatSSE(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createRunsEventBus() {
  // Map<workflowId, Set<res>>
  const subscribers = new Map();

  function getSet(workflowId) {
    let set = subscribers.get(workflowId);
    if (!set) {
      set = new Set();
      subscribers.set(workflowId, set);
    }
    return set;
  }

  /**
   * Subscribe a response (SSE connection) to a workflow's events.
   * Sets SSE headers (if res supports setHeader) and writes an initial
   * `:ping\n\n` to flush headers through any buffering proxy.
   */
  function subscribe(workflowId, res) {
    const set = getSet(workflowId);
    set.add(res);
    if (typeof res.setHeader === "function") {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }
    try {
      res.write(":ping\n\n");
    } catch {
      // res already closed — remove immediately to avoid leak.
      set.delete(res);
      if (set.size === 0) subscribers.delete(workflowId);
    }
  }

  /**
   * Broadcast an event to ALL subscribers of a single workflow.
   * Dead connections (EPIPE on write) are silently removed.
   */
  function broadcast(workflowId, event) {
    const set = subscribers.get(workflowId);
    if (!set || set.size === 0) return;
    const data = formatSSE(event);
    for (const res of set) {
      try {
        res.write(data);
      } catch {
        // EPIPE or similar — tab closed or connection dropped. Remove.
        set.delete(res);
      }
    }
    if (set.size === 0) subscribers.delete(workflowId);
  }

  /**
   * Remove a subscriber. Deletes the workflow's Set if it becomes empty.
   */
  function unsubscribe(workflowId, res) {
    const set = subscribers.get(workflowId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) subscribers.delete(workflowId);
  }

  /**
   * Broadcast to subscribers of ALL workflows. Used for `workflow_deleted`
   * so every viewer (regardless of which workflow they're watching) is notified.
   */
  function broadcastAll(event) {
    const data = formatSSE(event);
    for (const set of subscribers.values()) {
      for (const res of set) {
        try {
          res.write(data);
        } catch {
          set.delete(res);
        }
      }
    }
    // Clean up empty sets to avoid leak.
    for (const [wfId, set] of subscribers) {
      if (set.size === 0) subscribers.delete(wfId);
    }
  }

  /** Test/debug helper: subscriber count for a workflow. */
  function subscriberCount(workflowId) {
    return subscribers.get(workflowId)?.size ?? 0;
  }

  return { subscribe, broadcast, unsubscribe, broadcastAll, subscriberCount };
}
