import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runAgentExecution } from "../server/agent-execution.mjs";
import { compileStrictSchema } from "../server/structured-output.mjs";

/**
 * #320: StructuredOutput-tool-route terminal classification.
 *
 * The model's final answer is a StructuredOutput toolCall (arguments parsed by
 * pi, never raw text JSON). Validation/self-correction happens inside the pi
 * agent loop (customTool execute feedback); the execution layer only re-reads
 * the LAST assistant message, extracts the final toolCall, and re-validates
 * defensively (script-side second check).
 *
 * Covers (acceptance): toolCall success, toolCall validation failure, exit
 * without calling the tool (fail-fast), refusal, incomplete, empty, no
 * assistant message, provider error, cancellation, and the legacy (no-contract)
 * path.
 *
 * The fake session scripts per-turn assistant messages: each turn's `messages`
 * are appended to session.messages (duck-typing the real session's `messages`
 * getter), and `prompt` records the text so tests can assert the refusal retry
 * prompt semantics.
 */

const COMPILED = compileStrictSchema({
  type: "object",
  properties: { result: { type: "string" }, n: { type: "integer" } },
});

function makeAssistant(text, { stopReason = "stop", errorMessage } = {}) {
  return { role: "assistant", content: [{ type: "text", text }], stopReason, errorMessage };
}

/** Assistant message whose content is a StructuredOutput toolCall block. */
function makeToolCallAssistant(args, { stopReason = "toolUse", errorMessage } = {}) {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "call_so_1", name: "StructuredOutput", arguments: args }],
    stopReason,
    errorMessage,
  };
}

/**
 * Scripted fake session.
 * @param {Array<{ messages?: object[], failPrompt?: Error }>} turns
 */
function makeFakeSession(turns) {
  let listener = null;
  const promptCalls = [];
  const session = {
    _messages: [],
    subscribe(fn) {
      listener = fn;
      return () => { listener = null; };
    },
    async prompt(text) {
      promptCalls.push(text);
      const turn = turns[promptCalls.length - 1];
      if (turn?.failPrompt) throw turn.failPrompt;
      session._messages = [...session._messages, ...(turn?.messages ?? [])];
      for (const ev of turn?.events ?? []) listener?.(ev);
    },
    async abort() {},
    agent: { waitForIdle() { return Promise.resolve(); } },
    dispose() {},
    _getPromptCalls() { return promptCalls; },
  };
  Object.defineProperty(session, "messages", {
    get() { return session._messages; },
  });
  return session;
}

/** Drain a runAgentExecution generator to its single terminal event. */
async function collect(runOpts) {
  const collected = [];
  for await (const ev of runAgentExecution(runOpts)) {
    if (ev.type === "terminal") collected.push(ev);
  }
  assert.equal(collected.length, 1, "exactly one terminal");
  return collected[0];
}

const BASE = {
  agentConfig: { id: "a1", name: "t", provider_base_url: "http://x", model: "m", provider_api_key: "k" },
  prompt: "do it",
  signal: undefined,
  createSession: () => Promise.resolve(),
  agentDir: "/tmp/x",
};

describe("structured output tool-route terminal classification (#320)", () => {
  test("StructuredOutput toolCall with valid arguments → succeeded with projected outputs", async () => {
    const session = makeFakeSession([
      { messages: [makeToolCallAssistant({ result: "ok", n: 3 })] },
    ]);
    const terminal = await collect({
      ...BASE,
      structured: COMPILED,
      createSession: async () => session,
    });
    assert.equal(terminal.phase, "succeeded");
    assert.deepEqual(terminal.outputs, { result: "ok", n: 3 });
    assert.equal(terminal.finalText, "");
  });

  test("extra fields in toolCall arguments are rejected (projection only)", async () => {
    const session = makeFakeSession([
      { messages: [makeToolCallAssistant({ result: "ok", n: 3, secret: "x" })] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "structured_output_error");
    assert.match(terminal.error.message, /unexpected extra field "secret"/);
  });

  test("prototype-chain keys cannot smuggle extra fields", async () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
      const session = makeFakeSession([
        { messages: [makeToolCallAssistant({ result: "ok", n: 3, [key]: "x" })] },
      ]);
      const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
      assert.equal(terminal.phase, "failed", `${key} must be rejected`);
      assert.equal(terminal.error.kind, "structured_output_error", `${key} must be a validation error`);
      assert.match(terminal.error.message, new RegExp(`unexpected extra field "${key}"`));
    }
  });

  test("type mismatch in toolCall arguments fails with field-level reasons — no corrective turn", async () => {
    // Self-correction lives inside the pi loop (customTool feedback); the
    // execution layer never issues a second prompt.
    const session = makeFakeSession([
      { messages: [makeToolCallAssistant({ result: "ok", n: "3" })] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.match(terminal.error.message, /field "n" must be integer/);
    assert.equal(session._getPromptCalls().length, 1, "no corrective prompt in the tool route");
  });

  test("missing field in toolCall arguments fails with the missing field named", async () => {
    const session = makeFakeSession([
      { messages: [makeToolCallAssistant({ result: "ok" })] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.match(terminal.error.message, /missing required field "n"/);
    assert.equal(session._getPromptCalls().length, 1);
  });

  test("exit without calling StructuredOutput (plain-text answer) → fail-fast", async () => {
    // The model ignored the MUST-call instruction and answered in text.
    const session = makeFakeSession([
      { messages: [makeAssistant('{"result":"ok","n":3}')] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "structured_output_error");
    assert.match(terminal.error.message, /without calling StructuredOutput/);
    assert.equal(session._getPromptCalls().length, 1, "text JSON is not accepted in the tool route");
  });

  test("refusal is asked again once in the same session, then succeeds via toolCall", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant("", { stopReason: "error", errorMessage: "Provider finish_reason: refusal" })] },
      { messages: [makeToolCallAssistant({ result: "fine", n: 0 })] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "succeeded");
    assert.deepEqual(terminal.outputs, { result: "fine", n: 0 });
    assert.equal(session._getPromptCalls().length, 2);
  });

  test("refusal after retry → failed structured_output_error", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant("", { stopReason: "error", errorMessage: "refusal" })] },
      { messages: [makeAssistant("", { stopReason: "error", errorMessage: "refusal" })] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "structured_output_error");
    assert.match(terminal.error.message, /refused/);
  });

  test("incomplete (max tokens) fails directly — no retry", async () => {
    const session = makeFakeSession([
      { messages: [makeToolCallAssistant({ result: "trunc", n: 1 }, { stopReason: "length" })] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "structured_output_error");
    assert.match(terminal.error.message, /incomplete/);
    assert.equal(session._getPromptCalls().length, 1, "incomplete never retries");
  });

  test("empty message (no toolCall, no text) fails directly", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant("   \n", { stopReason: "stop" })] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.match(terminal.error.message, /empty response/);
    assert.equal(session._getPromptCalls().length, 1);
  });

  test("no assistant message at all → failed (no fake success)", async () => {
    const session = makeFakeSession([{ messages: [] }]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.match(terminal.error.message, /no assistant response/);
  });

  test("provider error stop reason fails as provider_error, not empty/structured", async () => {
    const session = makeFakeSession([
      {
        messages: [
          makeToolCallAssistant({ result: "x", n: 1 }, {
            stopReason: "error",
            errorMessage: "upstream rejected the request",
          }),
        ],
      },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "provider_error");
    assert.match(terminal.error.message, /upstream rejected/);
    assert.equal(session._getPromptCalls().length, 1, "provider error never retries");
  });

  test("cancellation mid-run stays cancelled even with a structured contract", async () => {
    const ac = new AbortController();
    let resolvePrompt;
    const session = {
      _messages: [],
      subscribe() { return () => {}; },
      async prompt() { await new Promise((r) => { resolvePrompt = r; }); },
      async abort() { resolvePrompt?.(); },
      agent: { waitForIdle() { return Promise.resolve(); } },
      dispose() {},
    };
    Object.defineProperty(session, "messages", { get() { return session._messages; } });

    const iter = runAgentExecution({
      ...BASE,
      signal: ac.signal,
      structured: COMPILED,
      createSession: async () => session,
    });
    const nextPromise = iter.next();
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    const { value: terminal } = await nextPromise;
    assert.equal(terminal.phase, "cancelled");
  });

  test("provider prompt error keeps provider_error kind", async () => {
    const session = makeFakeSession([{ failPrompt: new Error("upstream 500") }]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "provider_error");
    assert.match(terminal.error.message, /upstream 500/);
  });

  test("tool-call budget: a model looping on other tools without StructuredOutput fails instead of hanging", async () => {
    // pi's agent loop has no iteration cap (#320 hardening): 11 tool_start
    // events (budget is 10) without a StructuredOutput call must abort and
    // fail with the budget message — never hang, never fake-success.
    const loopingEvents = Array.from({ length: 11 }, (_, i) => ({
      type: "tool_execution_start",
      toolName: `read_${i}`,
      args: { path: `/tmp/${i}` },
    }));
    const session = makeFakeSession([
      { events: loopingEvents, messages: [makeAssistant("still working...")] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "structured_output_error");
    assert.match(terminal.error.message, /tool-call budget \(10\)/);
  });

  test("tool-call budget does not trigger for legitimate sub-budget tool use", async () => {
    // A normal read-then-StructuredOutput flow (2 tool starts) stays well
    // under the budget and succeeds.
    const session = makeFakeSession([
      {
        events: [
          { type: "tool_execution_start", toolName: "read_file", args: { path: "/a" } },
          { type: "tool_execution_end", toolName: "read_file", result: "content" },
        ],
        messages: [makeToolCallAssistant({ result: "ok", n: 1 })],
      },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "succeeded");
    assert.deepEqual(terminal.outputs, { result: "ok", n: 1 });
  });
});

describe("legacy path (no structured contract) unchanged", () => {
  test("succeeded terminal keeps partialText semantics", async () => {
    const events = [
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } },
      { type: "agent_end", messages: [] },
    ];
    const session = makeFakeSession([{ events, messages: [makeAssistant("hello")] }]);
    const terminal = await collect({ ...BASE, createSession: async () => session });
    assert.equal(terminal.phase, "succeeded");
    assert.equal(terminal.partialText, "hello");
    assert.equal(terminal.outputs, undefined, "legacy terminals carry no outputs");
  });
});
