import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { runAgentExecution } from "../server/agent-execution.mjs";
import { compileStrictSchema } from "../server/structured-output.mjs";

/**
 * #249: strict parsing/validation + failure semantics for structured output.
 *
 * Covers (acceptance): valid JSON, invalid JSON, missing fields, extra
 * fields, type errors, refusal, incomplete, correction success/failure,
 * cancellation, and the legacy (no-contract) path.
 *
 * The fake session scripts per-turn assistant messages: each turn's `messages`
 * are appended to session.messages (duck-typing the real session's `messages`
 * getter), and `prompt` records the text so tests can assert the corrective
 * prompt carries field-level reasons (never raw text/credentials).
 */

const COMPILED = compileStrictSchema({
  type: "object",
  properties: { result: { type: "string" }, n: { type: "integer" } },
});

function makeAssistant(text, { stopReason = "stop", errorMessage } = {}) {
  return { role: "assistant", content: [{ type: "text", text }], stopReason, errorMessage };
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

describe("structured output terminal classification (#249)", () => {
  test("valid JSON with all declared fields → succeeded with projected outputs only", async () => {
    const session = makeFakeSession([{ messages: [makeAssistant('{"result":"ok","n":3}')] }]);
    const terminal = await collect({
      ...BASE,
      structured: COMPILED,
      createSession: async () => session,
    });
    assert.equal(terminal.phase, "succeeded");
    assert.deepEqual(terminal.outputs, { result: "ok", n: 3 });
    assert.equal(terminal.finalText, '{"result":"ok","n":3}');
  });

  test("extra fields in the response are rejected (projection only)", async () => {
    const session = makeFakeSession([{ messages: [makeAssistant('{"result":"ok","n":3,"secret":"x"}')] }]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "structured_output_error");
    assert.match(terminal.error.message, /unexpected extra field "secret"/);
  });

  test("invalid JSON corrects once in the same session, then succeeds", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant("not json at all")] },
      { messages: [makeAssistant('{"result":"fixed","n":1}')] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "succeeded");
    assert.deepEqual(terminal.outputs, { result: "fixed", n: 1 });
    // The corrective prompt carries the field-level reason, and the retry is
    // in the SAME session (two prompt calls on one session).
    const calls = session._getPromptCalls();
    assert.equal(calls.length, 2);
    assert.match(calls[1], /did not match the required JSON schema/);
    assert.match(calls[1], /not valid JSON/);
  });

  test("invalid JSON corrects once, then fails with field-level summary", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant("still not json")] },
      { messages: [makeAssistant("still not json either")] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "structured_output_error");
    assert.match(terminal.error.message, /not valid JSON/);
    assert.equal(session._getPromptCalls().length, 2, "at most one correction");
  });

  test("type mismatch corrects once (integer not coerced), then fails", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant('{"result":"ok","n":"3"}')] }, // string where integer required
      { messages: [makeAssistant('{"result":"ok","n":true}')] }, // still wrong
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.match(terminal.error.message, /field "n" must be integer/);
    assert.match(session._getPromptCalls()[1], /field "n" must be integer/);
  });

  test("missing field corrects once then succeeds", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant('{"result":"ok"}')] }, // missing n
      { messages: [makeAssistant('{"result":"ok","n":2}')] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "succeeded");
    assert.deepEqual(terminal.outputs, { result: "ok", n: 2 });
    assert.match(session._getPromptCalls()[1], /missing required field "n"/);
  });

  test("refusal is asked again once in the same session, then succeeds", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant("", { stopReason: "error", errorMessage: "Provider finish_reason: refusal" })] },
      { messages: [makeAssistant('{"result":"fine","n":0}')] },
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

  test("incomplete (max tokens) fails directly — no correction", async () => {
    const session = makeFakeSession([
      { messages: [makeAssistant('{"result":"trunc', { stopReason: "length" })] },
    ]);
    const terminal = await collect({ ...BASE, structured: COMPILED, createSession: async () => session });
    assert.equal(terminal.phase, "failed");
    assert.equal(terminal.error.kind, "structured_output_error");
    assert.match(terminal.error.message, /incomplete/);
    assert.equal(session._getPromptCalls().length, 1, "incomplete never corrects");
  });

  test("empty text fails directly — no correction", async () => {
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
