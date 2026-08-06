/**
 * Phase 5 (#157): per-workflow SSE event bus for Workflow Run broadcasts.
 *
 * The bus owns event identity and subscription filtering. Hono owns the
 * transport and backpressure; its route subscribes with `push(frame)` and
 * drains the bounded queue through `streamSSE().writeSSE()`.
 *
 * A legacy `write(chunk)` target remains supported for the deterministic test
 * harness and direct bus tests. Production code uses `push(frame)`.
 *
 * Event types:
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
 *       Broadcast only to that workflow's subscribers when a workflow is
 *       deleted (Phase 6 wires this into DELETE /api/workflows/:id).
 *
 * Init frame (sent once on subscribe, not via broadcast):
 *   {type:'init', workflowId, activeRunIDs: string[], activeRuns: Array<{runID, status, report}>}
 *   #179: `activeRuns` carries the latest intermediate IReport for each running
 *   run (via queue.getCurrentReport) so a late subscriber immediately sees the
 *   current per-node state. `activeRunIDs` is kept for backward-compat.
 *
 * Out of scope: cross-server broadcast (single-process only; no Redis).
 */

const PROGRESS_EVENT = 'run_progress';
const DONE = Symbol('sse_queue_done');

function isProgressFrame(frame) {
  return frame?.payload?.type === PROGRESS_EVENT;
}

function isHeartbeatFrame(frame) {
  return frame?.kind === 'heartbeat';
}

function formatEventFrame(frame) {
  return `data: ${JSON.stringify(frame.payload)}\nid: ${frame.id}\n\n`;
}

function normalizeFilter(values) {
  if (!values) return null;
  const normalized = values instanceof Set ? values : new Set(values);
  return normalized.size > 0 ? normalized : null;
}

/**
 * Bounded per-connection queue. Progress is latest-wins per run and may be
 * dropped when the queue is full; lifecycle frames are retained. If lifecycle
 * frames alone fill the queue, closing the stream is safer than silently
 * dropping a terminal event; the client will reconcile from REST on retry.
 */
export function createSseEventQueue({ maxPending = 64 } = {}) {
  if (!Number.isInteger(maxPending) || maxPending < 1) {
    throw new RangeError('maxPending must be a positive integer');
  }

  let closed = false;
  const pending = [];
  const waiters = [];

  function resolveNext(value) {
    const resolve = waiters.shift();
    if (!resolve) return false;
    resolve({ value, done: value === DONE });
    return true;
  }

  function push(frame) {
    if (closed) return false;

    if (isHeartbeatFrame(frame)) {
      if (pending.some(isHeartbeatFrame) || pending.length >= maxPending) return false;
    }

    if (isProgressFrame(frame)) {
      const existingIndex = pending.findIndex(
        (item) => isProgressFrame(item) && item.payload.runID === frame.payload.runID
      );
      if (existingIndex >= 0) {
        pending[existingIndex] = frame;
        return true;
      }
      if (pending.length >= maxPending) return false;
    } else if (pending.length >= maxPending) {
      const progressIndex = pending.findIndex(isProgressFrame);
      if (progressIndex >= 0) {
        pending.splice(progressIndex, 1);
      } else {
        close();
        return false;
      }
    }

    if (resolveNext(frame)) return true;
    pending.push(frame);
    return true;
  }

  function next() {
    if (pending.length > 0) {
      return Promise.resolve({ value: pending.shift(), done: false });
    }
    if (closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => waiters.push(resolve));
  }

  function close() {
    if (closed) return;
    closed = true;
    pending.length = 0;
    while (waiters.length > 0) resolveNext(DONE);
  }

  return {
    push,
    close,
    next,
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

export function createRunsEventBus() {
  // Map<workflowId, Set<{target, runIDs, types, active}>>
  const subscribers = new Map();
  const sequences = new Map();

  function getSet(workflowId) {
    let set = subscribers.get(workflowId);
    if (!set) {
      set = new Set();
      subscribers.set(workflowId, set);
    }
    return set;
  }

  function nextFrame(workflowId, event) {
    const sequence = (sequences.get(workflowId) ?? 0) + 1;
    sequences.set(workflowId, sequence);
    return {
      id: String(sequence),
      sequence,
      payload: { ...event, workflowId, sequence },
    };
  }

  function matches(record, payload, force) {
    if (force || payload.type === 'init' || payload.type === 'workflow_deleted') return true;
    if (record.types && !record.types.has(payload.type)) return false;
    if (record.runIDs && payload.runID && !record.runIDs.has(payload.runID)) return false;
    return true;
  }

  function removeRecord(record) {
    const set = subscribers.get(record.workflowId);
    if (!set) return;
    set.delete(record);
    record.active = false;
    if (set.size === 0) subscribers.delete(record.workflowId);
  }

  function deliver(record, frame, force = false) {
    if (!record.active || !matches(record, frame.payload, force)) return true;
    try {
      if (typeof record.target.push === 'function') {
        // False means a droppable progress frame was rejected by the queue.
        return record.target.push(frame) !== false;
      }
      const result = record.target.write(formatEventFrame(frame), frame.payload);
      return result !== false;
    } catch {
      removeRecord(record);
      return false;
    }
  }

  function subscribe(workflowId, target, { runIDs, types } = {}) {
    if (!target || (typeof target.write !== 'function' && typeof target.push !== 'function')) {
      throw new TypeError('subscriber target must provide write or push');
    }
    const record = {
      workflowId,
      target,
      runIDs: normalizeFilter(runIDs),
      types: normalizeFilter(types),
      active: true,
    };
    getSet(workflowId).add(record);

    // Keep the direct-bus test seam's header flush. Hono streamSSE sends
    // headers and the ping from its route instead.
    if (typeof target.write === 'function') {
      try {
        target.setHeader?.('Content-Type', 'text/event-stream');
        target.setHeader?.('Cache-Control', 'no-cache');
        target.setHeader?.('Connection', 'keep-alive');
        target.write(':ping\n\n');
      } catch {
        removeRecord(record);
      }
    }

    const handle = {
      send(event) {
        if (!record.active) return false;
        return deliver(record, nextFrame(workflowId, event));
      },
      unsubscribe() {
        removeRecord(record);
      },
      get active() {
        return record.active;
      },
    };
    record.handle = handle;
    return handle;
  }

  function broadcast(workflowId, event) {
    const frame = nextFrame(workflowId, event);
    const set = subscribers.get(workflowId);
    if (!set) return;
    for (const record of [...set]) deliver(record, frame);
  }

  function broadcastAll(event) {
    if (event?.workflowId) {
      broadcast(event.workflowId, event);
      return;
    }
    for (const [workflowId, set] of subscribers) {
      const frame = nextFrame(workflowId, event);
      for (const record of [...set]) deliver(record, frame, true);
    }
  }

  function unsubscribe(workflowId, target) {
    const set = subscribers.get(workflowId);
    if (!set) return;
    for (const record of set) {
      if (record === target || record.target === target || record.handle === target) {
        removeRecord(record);
      }
    }
  }

  function subscriberCount(workflowId) {
    return subscribers.get(workflowId)?.size ?? 0;
  }

  function connectionCount(workflowId) {
    if (workflowId !== undefined) return subscriberCount(workflowId);
    let count = 0;
    for (const set of subscribers.values()) count += set.size;
    return count;
  }

  function dispose() {
    for (const set of subscribers.values()) {
      for (const record of set) {
        record.active = false;
        record.target.close?.();
      }
    }
    subscribers.clear();
  }

  return {
    subscribe,
    broadcast,
    unsubscribe,
    broadcastAll,
    subscriberCount,
    connectionCount,
    dispose,
  };
}
