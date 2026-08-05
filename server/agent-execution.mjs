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
 * agent.waitForIdle). Structured-output semantics (#249) come from the
 * schema module, which is also pi-free.
 */

import {
  buildCorrectionPrompt,
  extractFinalAssistantMessage,
  isIncompleteMessage,
  isRefusalMessage,
  validateStructuredOutput,
  REFUSAL_RETRY_PROMPT,
} from "./structured-output.mjs";

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
 * @param {(agentConfig: object, agentDir: string) => Promise<object>} opts.createSession
 *   Closure with apiKey already bound by the caller. Shared module never
 *   resolves credentials.
 * @param {string} opts.agentDir
 * @param {{ schema: object, name: string }|null} [opts.structured] - compiled
 *   structured output contract for this run (#248). When set, the terminal
 *   carries validated `outputs` (only declared fields) and the final
 *   assistant text is taken from the LAST assistant message, not the
 *   streaming partialText (#243). Refusal retries once in the same session;
 *   invalid JSON / field mismatch corrects once; incomplete/empty fails.
 * @returns {AsyncGenerator<AgentExecutionEvent>}
 */
export async function* runAgentExecution({
  agentConfig,
  prompt,
  signal,
  createSession,
  agentDir,
  structured = null,
}) {
  // Pre-aborted short-circuit: don't waste a session creation on a cancelled run.
  if (signal?.aborted) {
    yield { type: "terminal", phase: "cancelled", partialText: "", toolEvents: [], stats: null, sessionFile: null };
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

  // Run one prompt cycle: submit, stream until settle, drain leftovers after
  // waitForIdle. Closure-captured state (queue/promptSettled/closed) is reset
  // per turn so a structured contract can drive at most one corrective turn
  // in the SAME session. Non-terminal events are yielded for streaming; the
  // resolved turn result ({ promptError }) is the generator's return value.
  async function* runTurn(promptText) {
    promptSettled.value = false;
    closed.value = false;
    let turnError;
    session.prompt(promptText).then(
      () => { promptSettled.value = true; wake(); },
      (err) => { turnError = err; promptSettled.value = true; wake(); },
    );
    // Yield streaming events as they arrive, until the prompt settles. drain()
    // blocks until an event arrives OR promptSettled wakes it with an empty queue.
    while (!promptSettled.value) {
      const ev = await drainUntil(promptSettled);
      if (ev === null) break;
      if (ev.type !== "terminal") yield ev;
    }
    await session.agent.waitForIdle();
    // Drain any remaining events that fired between prompt settle and waitForIdle.
    closed.value = true;
    wake();
    let ev;
    while ((ev = await drainUntil(closed)) !== null) {
      if (ev.type !== "terminal") yield ev;
    }
    return { promptError: turnError };
  }

  try {
    session = await createSession(agentConfig, agentDir);

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

    // Run the agent loop. A structured contract may drive at most one extra
    // turn in the SAME session (#243/#249): a refusal is asked again once,
    // and an invalid/unparseable response gets one corrective prompt carrying
    // only field-level reasons (never credentials or raw text).
    let turnPrompt = prompt;
    let correctionUsed = false;
    let finalMessage = null;
    let lastValidation = null; // { ok, outputs?, errors? } for the final turn

    while (true) {
      const turnGen = runTurn(turnPrompt);
      let turnResult;
      while (true) {
        const { value, done } = await turnGen.next();
        if (done) {
          turnResult = value;
          break;
        }
        yield value; // non-terminal streaming event
      }
      if (turnResult.promptError) {
        promptError = turnResult.promptError;
        break;
      }
      if (!structured) break;

      finalMessage = extractFinalAssistantMessage(session);
      if (!finalMessage) break;

      if (isRefusalMessage(finalMessage) && !correctionUsed) {
        correctionUsed = true;
        turnPrompt = REFUSAL_RETRY_PROMPT;
        continue;
      }
      if (isIncompleteMessage(finalMessage)) break;
      if (!finalMessage.text.trim()) break; // empty response — classified below

      let parsed;
      try {
        parsed = JSON.parse(finalMessage.text);
      } catch {
        parsed = null;
      }
      const result =
        parsed === null
          ? { ok: false, errors: ["response is not valid JSON"] }
          : validateStructuredOutput(parsed, structured);
      lastValidation = result;
      if (!result.ok && !correctionUsed) {
        correctionUsed = true;
        turnPrompt = buildCorrectionPrompt(result.errors);
        continue;
      }
      break;
    }

    signal?.removeEventListener("abort", onAbort);

    // Extension error bridge (#248): a capability failure raised inside
    // before_provider_request is swallowed by the extension runner (it emits
    // the error instead of failing the request). The session creator binds
    // onError to record it here; classify as a capability terminal BEFORE any
    // other classification so an unshaped request is never presented as a
    // structured success.
    const extensionError = session._lastExtensionError;
    if (
      extensionError?.kind === "capability_error" &&
      !signal?.aborted &&
      !promptError
    ) {
      yield {
        type: "terminal",
        phase: "failed",
        partialText,
        toolEvents,
        stats: null,
        sessionFile,
        error: { kind: "capability_error", message: extensionError.message },
      };
      return;
    }

    // Terminal classification: signal.aborted takes precedence over promptError.
    // If the user cancelled, the terminal is "cancelled" even if the provider
    // also rejected prompt() in response to the abort (#66 rule: classification
    // MUST use signal.aborted, not event inspection).
    const stats = session.getSessionStats?.() ?? null;
    const sessionFile = session.sessionFile ?? null;

    if (signal?.aborted) {
      yield { type: "terminal", phase: "cancelled", partialText, toolEvents, stats, sessionFile };
      return;
    }

    if (promptError) {
      yield {
        type: "terminal",
        phase: "failed",
        partialText,
        toolEvents,
        stats,
        sessionFile,
        error: toErrorKind(promptError),
      };
      return;
    }

    // Structured classification (#249): fail/terminate on anything that is not
    // a validated projection of the declared fields. `outputs` only ever
    // contains verified declared fields; the raw final text stays available
    // for diagnostics via `finalText` (never part of the outputs contract).
    if (structured) {
      if (!finalMessage) {
        yield {
          type: "terminal", phase: "failed", partialText, toolEvents, stats, sessionFile,
          error: { kind: "structured_output_error", message: "agent produced no assistant response" },
        };
        return;
      }
      if (isRefusalMessage(finalMessage)) {
        yield {
          type: "terminal", phase: "failed", partialText, toolEvents, stats, sessionFile,
          error: { kind: "structured_output_error", message: "provider refused the request after retry" },
        };
        return;
      }
      if (isIncompleteMessage(finalMessage)) {
        yield {
          type: "terminal", phase: "failed", partialText, toolEvents, stats, sessionFile,
          error: { kind: "structured_output_error", message: "response incomplete (max tokens reached)" },
        };
        return;
      }
      // Provider error surfaced as an assistant message (e.g. an endpoint
      // rejecting response_format) — classify as provider_error, never as an
      // empty/structured failure, and never as a structured success.
      if (finalMessage.stopReason === "error") {
        yield {
          type: "terminal", phase: "failed", partialText, toolEvents, stats, sessionFile,
          error: {
            kind: "provider_error",
            message: finalMessage.errorMessage || "provider returned an error stop reason",
          },
        };
        return;
      }
      if (!finalMessage.text.trim()) {
        yield {
          type: "terminal", phase: "failed", partialText, toolEvents, stats, sessionFile,
          error: { kind: "structured_output_error", message: "agent produced an empty response" },
        };
        return;
      }
      if (!lastValidation?.ok) {
        const summary = lastValidation?.errors?.join("; ") ?? "response is not valid JSON";
        yield {
          type: "terminal", phase: "failed", partialText, toolEvents, stats, sessionFile,
          error: { kind: "structured_output_error", message: `structured output validation failed: ${summary}` },
        };
        return;
      }
      yield {
        type: "terminal",
        phase: "succeeded",
        partialText,
        toolEvents,
        stats,
        sessionFile,
        outputs: lastValidation.outputs,
        finalText: finalMessage.text,
      };
      return;
    }

    yield { type: "terminal", phase: "succeeded", partialText, toolEvents, stats, sessionFile };
  } catch (err) {
    yield {
      type: "terminal",
      phase: "failed",
      partialText,
      toolEvents,
      stats: null,
      sessionFile: null,
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
 * Error subclasses carrying their own `kind` (AgentExecutionError,
 * StructuredOutputCapabilityError, ...) keep it — the terminal classification
 * layer relies on kind for capability/structured errors (#248/#249).
 * Non-Error values get a generic provider_error kind.
 */
function toErrorKind(err) {
  if (err instanceof Error) {
    return {
      kind: err.kind ?? "provider_error",
      message: err.message || "Agent Execution failed",
    };
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
