const FRAME_SEPARATOR = '\n\n';

function parseSseEvents(chunk) {
  return chunk
    .split(FRAME_SEPARATOR)
    .filter(Boolean)
    .map((frame) => frame.split('\n').find((line) => line.startsWith('data:')))
    .filter(Boolean)
    .map((line) => line.slice('data:'.length).trim())
    .map((data) => JSON.parse(data));
}

function normalizeFaults(faults = {}) {
  const delayMs = Number(faults.delayMs ?? 0);
  const duplicate = Number(faults.duplicate ?? 0);
  return {
    delayMs: Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0,
    duplicate: Number.isFinite(duplicate) ? Math.max(0, Math.floor(duplicate)) : 0,
    reorder: faults.reorder === true,
    drop: typeof faults.drop === 'function' ? faults.drop : () => false,
  };
}

/**
 * Build deterministic fake SSE connections around a real runs event bus.
 *
 * The harness is test-only. It keeps transport faults out of production code
 * while making connection lifecycle and event delivery observable without a
 * browser or an origin connection limit.
 */
export function createSseTestHarness({ eventBus } = {}) {
  if (
    !eventBus ||
    typeof eventBus.subscribe !== 'function' ||
    typeof eventBus.unsubscribe !== 'function' ||
    typeof eventBus.connectionCount !== 'function'
  ) {
    throw new TypeError('eventBus with subscribe, unsubscribe, and connectionCount is required');
  }

  const connections = new Set();
  let nextConnectionID = 1;

  function connect(
    workflowId,
    { onEvent = () => {}, onError = () => {}, faults: initialFaults } = {},
  ) {
    if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
    if (typeof onError !== 'function') throw new TypeError('onError must be a function');

    let faults = normalizeFaults(initialFaults);
    let reorderBuffer;
    const pendingDeliveries = new Set();
    const connection = {
      id: `sse-test-${nextConnectionID++}`,
      workflowId,
      events: [],
      writes: [],
      headers: {},
      closed: false,
      broken: false,
      get faults() {
        return faults;
      },
      setFaults(nextFaults) {
        faults = normalizeFaults({ ...faults, ...nextFaults });
      },
      close() {
        if (connection.closed) return;
        connection.closed = true;
        eventBus.unsubscribe(workflowId, response);
        connections.delete(connection);
      },
      break() {
        if (!connection.closed) connection.broken = true;
      },
      async flush() {
        if (reorderBuffer !== undefined) {
          const buffered = reorderBuffer;
          reorderBuffer = undefined;
          schedule(buffered);
        }
        while (pendingDeliveries.size > 0) {
          await Promise.all([...pendingDeliveries]);
        }
      },
    };

    function deliver(event) {
      if (connection.closed) return;
      connection.events.push(event);
      onEvent(event);
    }

    function schedule(event) {
      const copies = 1 + faults.duplicate;
      for (let index = 0; index < copies; index++) {
        if (faults.delayMs === 0) {
          deliver(event);
          continue;
        }
        let resolveDelivery;
        const pending = new Promise((resolve) => {
          resolveDelivery = resolve;
        });
        pendingDeliveries.add(pending);
        setTimeout(() => {
          pendingDeliveries.delete(pending);
          try {
            deliver(event);
          } finally {
            resolveDelivery();
          }
        }, faults.delayMs);
      }
    }

    function enqueue(event) {
      if (faults.drop(event)) return;
      if (!faults.reorder) {
        schedule(event);
        return;
      }
      if (reorderBuffer === undefined) {
        reorderBuffer = event;
        return;
      }
      const buffered = reorderBuffer;
      reorderBuffer = undefined;
      schedule(event);
      schedule(buffered);
    }

    const response = {
      write(chunk) {
        if (connection.closed) {
          throw new Error('SSE test connection is closed');
        }
        if (connection.broken) {
          onError();
          throw new Error('SSE test connection is broken');
        }
        connection.writes.push(chunk);
        for (const event of parseSseEvents(chunk)) enqueue(event);
        return true;
      },
      setHeader(name, value) {
        connection.headers[name] = value;
      },
    };

    connections.add(connection);
    eventBus.subscribe(workflowId, response);
    return connection;
  }

  /** Create an EventSource-shaped client for browser consumer tests. */
  function createEventSource(workflowId, { faults: initialFaults } = {}) {
    let source;
    const connection = connect(workflowId, {
      faults: initialFaults,
      onEvent: (event) => source?.onmessage?.({ data: JSON.stringify(event) }),
      onError: () => source?.onerror?.({ type: 'error', target: source }),
    });
    source = {
      CONNECTING: 0,
      OPEN: 1,
      CLOSED: 2,
      readyState: 1,
      onmessage: null,
      onerror: null,
      connection,
      close() {
        connection.close();
        source.readyState = source.CLOSED;
      },
    };
    return source;
  }

  function connectionCount(workflowId) {
    return eventBus.connectionCount(workflowId);
  }

  function close() {
    for (const connection of [...connections]) connection.close();
  }

  return { connect, createEventSource, connectionCount, close };
}
