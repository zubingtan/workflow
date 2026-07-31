/**
 * Shared Agent Execution module — the pi-free adaptation layer.
 *
 * Owns: subscribe → translate pi AgentSessionEvent variants to neutral
 * AgentExecutionEvent / abort relay / await prompt + waitForIdle / dispose.
 * Emits exactly one terminal event per invocation. Non-terminal events are
 * yielded as they arrive (streaming), so the SSE adapter can push them in
 * real time; the task adapter ignores them and reads terminal.partialText /
 * terminal.toolEvents instead.
 *
 * Does NOT own: credential resolution (caller binds apiKey into createSession),
 * agent lookup, HTTP/SSE framing, task transport. Those live in the adapters
 * (server/sse-adapter.mjs, server/runtime-adapter.mjs) and routes
 * (server/index.mjs).
 *
 * pi-free: imports nothing from @earendil-works/*. Duck-types the injected
 * session's event variants and 5 methods (subscribe, prompt, abort, dispose,
 * agent.waitForIdle).
 */

/**
 * Run an Agent Execution against an injected pi session, yielding neutral
 * AgentExecutionEvents as they arrive, ending with exactly one terminal event.
 *
 * @param {object} opts
 * @param {object} opts.agentConfig - agent row (provider_base_url, model, etc.)
 * @param {string} opts.prompt - user prompt text
 * @param {AbortSignal} [opts.signal] - cancellation signal; when aborted the
 *   terminal phase becomes "cancelled". Pre-aborted signals short-circuit
 *   WITHOUT creating a session.
 * @param {(agentConfig: object, agentDir: string, runID?: string) => Promise<object>} opts.createSession
 *   Closure with apiKey already bound by the caller. Shared module never
 *   resolves credentials.
 * @param {string} opts.agentDir
 * @param {string} [opts.runID] - workflow runID for mem0 provenance (D3).
 * @returns {AsyncGenerator<AgentExecutionEvent>}
 */
export async function* runAgentExecution({
  agentConfig,
  prompt,
  signal,
  createSession,
  agentDir,
  runID = "",
}) {
  // Pre-aborted short-circuit: don't waste a session creation on a cancelled run.
  if (signal?.aborted) {
    yield { type: "terminal", phase: "cancelled", partialText: "", toolEvents: [] };
    return;
  }

  // Async queue: subscribe callback pushes translated events; the generator
  // loop drains them. `wake()` unblocks a pending drain when either an event
  // arrives or the prompt settles (so the streaming loop can exit).
  const queue = [];
  let queueResolve = null;
  const closed = { value: false };
  const promptSettled = { value: false };
  function push(ev) {
    queue.push(ev);
    wake();
  }
  function wake() {
    if (queueResolve) {
      const r = queueResolve;
      queueResolve = null;
      r();
    }
  }
  // Returns the next queued event, or null when the queue is empty AND the
  // stop condition is met. `stop` is the flag whose truthiness ends the drain:
  //   - promptSettled: for the streaming loop (stop when prompt resolves)
  //   - closed: for the final drain (stop after waitForIdle completes)
  async function drainUntil(stop) {
    while (true) {
      if (queue.length > 0) return queue.shift();
      if (stop.value) return null;
      await new Promise((r) => { queueResolve = r; });
    }
  }

  let session;
  let unsubscribe;
  let partialText = "";
  const toolEvents = [];

  try {
    session = await createSession(agentConfig, agentDir, runID);

    let promptError;

    unsubscribe = session.subscribe((event) => {
      const translated = translateEvent(event);
      for (const ev of translated) {
        if (ev.type === "content_delta") {
          partialText += ev.content;
        } else if (ev.type === "tool_start" || ev.type === "tool_end") {
          toolEvents.push(ev);
        }
        push(ev);
      }
    });

    // Bridge cancellation: when signal aborts, call session.abort() (awaitable).
    let abortRequested = false;
    const onAbort = () => {
      if (!abortRequested) {
        abortRequested = true;
        void session.abort?.();
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    session.prompt(prompt).then(
      () => { promptSettled.value = true; wake(); },
      (err) => { promptError = err; promptSettled.value = true; wake(); },
    );

    // Yield streaming events as they arrive, until the prompt settles. drain()
    // blocks until an event arrives OR promptSettled wakes it with an empty queue.
    while (!promptSettled.value) {
      const ev = await drainUntil(promptSettled);
      if (ev === null) break;
      if (ev.type !== "terminal") yield ev;
    }

    await session.agent.waitForIdle();
    signal?.removeEventListener("abort", onAbort);

    // Drain any remaining events that fired between prompt settle and waitForIdle.
    closed.value = true;
    wake();
    let ev;
    while ((ev = await drainUntil(closed)) !== null) {
      if (ev.type !== "terminal") yield ev;
    }

    // Terminal classification: signal.aborted takes precedence over promptError.
    // If the user cancelled, the terminal is "cancelled" even if the provider
    // also rejected prompt() in response to the abort (#66 rule: classification
    // MUST use signal.aborted, not event inspection).
    if (signal?.aborted) {
      yield { type: "terminal", phase: "cancelled", partialText, toolEvents };
      return;
    }

    if (promptError) {
      yield {
        type: "terminal",
        phase: "failed",
        partialText,
        toolEvents,
        error: toErrorKind(promptError),
      };
      return;
    }

    yield { type: "terminal", phase: "succeeded", partialText, toolEvents };
  } catch (err) {
    yield {
      type: "terminal",
      phase: "failed",
      partialText,
      toolEvents,
      error: toErrorKind(err),
    };
  } finally {
    unsubscribe?.();
    session?.dispose?.();
  }
}

/**
 * Translate a pi AgentSessionEvent into zero or more neutral
 * AgentExecutionEvents. Three variants handled (matches existing mapEvent):
 *   - message_update + assistantMessageEvent.text_delta → content_delta
 *   - tool_execution_start → tool_start
 *   - tool_execution_end → tool_end
 * All other pi events (agent_end, message_end, turn_start, etc.) are ignored.
 */
function translateEvent(event) {
  switch (event.type) {
    case "message_update": {
      const e = event.assistantMessageEvent;
      if (e?.type === "text_delta" && e.delta) {
        return [{ type: "content_delta", content: e.delta }];
      }
      return [];
    }
    case "tool_execution_start":
      return [{ type: "tool_start", toolName: event.toolName, args: event.args }];
    case "tool_execution_end":
      return [{ type: "tool_end", toolName: event.toolName, result: event.result, isError: event.isError }];
    default:
      return [];
  }
}

/**
 * Map an arbitrary thrown value to an error-kind object for the terminal.
 * Non-Error values get a generic provider_error kind.
 */
function toErrorKind(err) {
  if (err instanceof Error) {
    return { kind: "provider_error", message: err.message || "Agent Execution failed" };
  }
  return { kind: "provider_error", message: String(err) || "Agent Execution failed" };
}

/**
 * SSE adapter's terminal projection: maps a shared-module terminal event to
 * the SSE event object the browser consumes. Used by server/sse-adapter.mjs.
 *
 *   succeeded → {type:"finish"}
 *   cancelled → {type:"cancelled"}   (additive event — browser consumes as
 *                                     authoritative server-side cancellation)
 *   failed    → {type:"error", message, kind}
 */
export function projectTerminal(terminal) {
  switch (terminal.phase) {
    case "succeeded":
      return { type: "finish" };
    case "cancelled":
      return { type: "cancelled" };
    case "failed":
      return {
        type: "error",
        message: terminal.error?.message ?? "Agent Execution failed",
        kind: terminal.error?.kind ?? "provider_error",
      };
    default:
      return { type: "error", message: "unknown terminal phase", kind: "internal_error" };
  }
}
