/**
 * Pure Agent Execution controller — the React-free core of useAgentExecution.
 *
 * Drives a single Agent Execution run against an injected `sendRequest`
 * function, invoking `onEvent` for each state transition. Owns the
 * AbortController, SSE framing, terminal classification, and re-run
 * auto-supersede semantics. The hook (use-agent-execution.ts) wraps this with
 * React state; tests drive this directly with a fake sendRequest (#54
 * decision 10).
 *
 * Contract:
 *   - Exactly one terminal event ({type:"terminal", phase:"succeeded"|"cancelled"|"failed", error?})
 *     is emitted per `run()` call, after all non-terminal events.
 *   - `cancel()` aborts the active run's AbortController. The in-flight run
 *     then emits `{type:"terminal", phase:"cancelled"}` because
 *     signal.aborted is true. The local mark is authoritative; a backend
 *     `{type:"cancelled"}` SSE event is consumed as the authoritative server
 *     signal but not depended upon (#54 decision 6, #76 calibration).
 *   - Re-run auto-supersedes: calling `run()` while a previous run is still
 *     active silently aborts the previous run WITHOUT emitting a terminal
 *     for it — the new run owns the terminal (#54 decision 8).
 *
 * @param {object} deps
 * @param {(input: RunInput, signal: AbortSignal) => Promise<Response>} deps.sendRequest
 *   Issues the HTTP request for a run. The hook binds this to api.runAgentById
 *   / api.testAgent so src/api.ts stays the sole HTTP client (AGENTS.md).
 *   Tests inject a fake that returns a scripted Response.
 * @param {(event: any) => void} [deps.onEvent]
 *   Callback for each state event. Emitted events:
 *     {type:"phase", phase:"streaming"}
 *     {type:"content_delta", content}
 *     {type:"tool_start"|"tool_end", ...}
 *     {type:"terminal", phase:"succeeded"|"cancelled"|"failed", error?}
 * @returns {{run: (input: any) => void, cancel: () => void, getActive: () => boolean}}
 */
export function createExecutionController({ sendRequest, onEvent } = {}) {
  let activeController = null;
  const emit = onEvent ?? (() => {});

  function cancel() {
    if (!activeController) return;
    activeController.abort();
    // Local mark is authoritative — see #54 decision 6.
    // The in-flight run's catch/finally will emit the cancelled terminal
    // because signal.aborted is now true.
  }

  function run(input) {
    // Auto-supersede: silently abort any in-flight run. The superseded run
    // will see signal.aborted and emit NO terminal (we clear activeController
    // first, so its post-abort checks `activeController !== controller` will
    // be true and it will bail without emitting).
    if (activeController) {
      const prev = activeController;
      activeController = null;
      prev.abort();
    }

    const controller = new AbortController();
    activeController = controller;

    emit({ type: 'phase', phase: 'streaming' });

    void (async () => {
      let res;
      try {
        res = await sendRequest(input, controller.signal);
      } catch (err) {
        // Superseded: another run replaced this controller. Emit nothing.
        if (activeController !== controller) return;
        if (controller.signal.aborted) {
          emit({ type: 'terminal', phase: 'cancelled' });
        } else {
          emit({ type: 'terminal', phase: 'failed', error: err?.message ?? 'Request failed' });
        }
        if (activeController === controller) activeController = null;
        return;
      }

      // Non-OK response: surface as failed (or cancelled if aborted).
      if (!res.ok || !res.body) {
        if (activeController !== controller) return; // superseded
        let msg = `HTTP ${res.status}`;
        try {
          const bodyJson = await res.json();
          if (bodyJson?.error) msg = bodyJson.error;
        } catch {
          // keep default msg
        }
        if (controller.signal.aborted) {
          emit({ type: 'terminal', phase: 'cancelled' });
        } else {
          emit({ type: 'terminal', phase: 'failed', error: msg });
        }
        if (activeController === controller) activeController = null;
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminalSeen = false;

      const finishWith = (terminal) => {
        if (activeController !== controller) return; // superseded
        terminalSeen = true;
        emit(terminal);
      };

      // Bridge cancel() → reader.cancel(). fetch's AbortSignal only aborts the
      // initial request; once the body is streaming, reader.read() won't
      // reject on signal.abort() unless we explicitly cancel the reader.
      const onAbort = () => {
        try {
          reader.cancel().catch(() => {});
        } catch {
          // ignore — reader may already be closed
        }
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });

      try {
        while (true) {
          let chunk;
          try {
            chunk = await reader.read();
          } catch (err) {
            if (activeController !== controller) return; // superseded
            if (controller.signal.aborted) {
              emit({ type: 'terminal', phase: 'cancelled' });
            } else {
              emit({ type: 'terminal', phase: 'failed', error: err?.message ?? 'Stream read failed' });
            }
            return;
          }
          const { done, value } = chunk;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (activeController !== controller) return; // superseded mid-stream
            const ev = parseLine(line);
            if (ev === null) continue;
            switch (ev.type) {
              case 'content_delta':
                emit({ type: 'content_delta', content: ev.content ?? '' });
                break;
              case 'tool_start':
              case 'tool_end':
                emit(ev);
                break;
              case 'finish':
                finishWith({ type: 'terminal', phase: 'succeeded' });
                break;
              case 'cancelled':
                finishWith({ type: 'terminal', phase: 'cancelled' });
                break;
              case 'error':
                finishWith({
                  type: 'terminal',
                  phase: 'failed',
                  error: ev.message ?? 'Agent Execution failed',
                });
                break;
              default:
                // Unknown event types ignored (forward-compatible).
                break;
            }
          }
        }
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
        try {
          reader.releaseLock?.();
        } catch {
          // ignore
        }
      }

      // Stream ended without an explicit terminal event.
      if (!terminalSeen && activeController === controller) {
        if (controller.signal.aborted) {
          emit({ type: 'terminal', phase: 'cancelled' });
        } else {
          emit({ type: 'terminal', phase: 'succeeded' });
        }
      }
      if (activeController === controller) activeController = null;
    })();
  }

  function getActive() {
    return activeController !== null;
  }

  return { run, cancel, getActive };
}

function parseLine(line) {
  if (!line.startsWith('data: ')) return null;
  const payload = line.slice(6).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
