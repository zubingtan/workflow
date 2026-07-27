import assert from 'node:assert/strict';
import test from 'node:test';

import { runAgentExecution } from '../server/agent-execution.mjs';

/**
 * Fake pi AgentSession for testing the shared module.
 * Scripts a queue of events to emit via subscribe; resolves prompt/waitForIdle
 * on demand so tests can drive the lifecycle precisely.
 */
function makeFakeSession(events = [], { failPrompt } = {}) {
  let listener;
  let aborted = false;
  let disposed = false;
  const session = {
    subscribe(fn) {
      listener = fn;
      return () => { listener = null; };
    },
    async prompt(_text) {
      if (failPrompt) throw failPrompt;
      // Emit all queued events synchronously after listener is attached.
      for (const ev of events) {
        if (listener) listener(ev);
      }
    },
    async abort() { aborted = true; },
    agent: {
      waitForIdle() { return Promise.resolve(); },
    },
    dispose() { disposed = true; },
    // introspection helpers for assertions
    _getAborted() { return aborted; },
    _getDisposed() { return disposed; },
  };
  return session;
}

test('runAgentExecution translates text_delta → content_delta and yields terminal succeeded with accumulated partialText', async () => {
  const events = [
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ', ' } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'world!' } },
    { type: 'agent_end', messages: [] },
  ];
  const session = makeFakeSession(events);
  const collected = [];
  for await (const ev of runAgentExecution({
    agentConfig: { id: 'a1', name: 'test', provider_base_url: 'http://x', model: 'm', provider_api_key: 'k-value' },
    prompt: 'hi',
    signal: undefined,
    createSession: async () => session,
    agentDir: '/tmp/x',
  })) {
    collected.push(ev);
  }

  const nonTerminal = collected.filter((e) => e.type !== 'terminal');
  const terminals = collected.filter((e) => e.type === 'terminal');
  assert.equal(terminals.length, 1, 'exactly one terminal event');
  assert.deepEqual(
    nonTerminal.map((e) => e.type),
    ['content_delta', 'content_delta', 'content_delta'],
  );
  assert.equal(nonTerminal[0].content, 'Hello');
  assert.equal(nonTerminal[2].content, 'world!');
  assert.equal(terminals[0].phase, 'succeeded');
  assert.equal(terminals[0].partialText, 'Hello, world!');
  assert.deepEqual(terminals[0].toolEvents, []);
  assert.equal(session._getDisposed(), true, 'session disposed on success');
});

test('runAgentExecution translates tool_execution_start/end → tool_start/tool_end and accumulates toolEvents on terminal', async () => {
  const events = [
    { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read', args: { path: '/a' } },
    { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'read', result: 'content', isError: false },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'done' } },
    { type: 'agent_end', messages: [] },
  ];
  const session = makeFakeSession(events);
  const collected = [];
  for await (const ev of runAgentExecution({
    agentConfig: { id: 'a1', name: 't', provider_base_url: 'http://x', model: 'm', provider_api_key: 'k-value' },
    prompt: 'p',
    createSession: async () => session,
    agentDir: '/tmp/x',
  })) {
    collected.push(ev);
  }

  const terminal = collected.find((e) => e.type === 'terminal');
  assert.equal(terminal.phase, 'succeeded');
  assert.equal(terminal.partialText, 'done');
  assert.equal(terminal.toolEvents.length, 2);
  assert.deepEqual(terminal.toolEvents[0], { type: 'tool_start', toolName: 'read', args: { path: '/a' } });
  assert.deepEqual(terminal.toolEvents[1], { type: 'tool_end', toolName: 'read', result: 'content', isError: false });
});

test('runAgentExecution classifies cancellation via signal.aborted → terminal cancelled (no throw)', async () => {
  const ac = new AbortController();
  let promptStarted = false;
  let promptResolve;
  const promptPromise = new Promise((r) => { promptResolve = r; });
  const session = {
    subscribe() { return () => {}; },
    async prompt() { promptStarted = true; await promptPromise; },
    async abort() { /* session.abort is awaitable */ },
    agent: { waitForIdle() { return Promise.resolve(); } },
    dispose() {},
  };

  const iter = runAgentExecution({
    agentConfig: { id: 'a1', name: 't', provider_base_url: 'http://x', model: 'm', provider_api_key: 'k-value' },
    prompt: 'p',
    signal: ac.signal,
    createSession: async () => session,
    agentDir: '/tmp/x',
  });

  // Kick the generator so it runs to the first await (createSession), then
  // settles subscribe + begins prompt. We don't await next() because it blocks
  // until the terminal event; we drive cancellation from outside instead.
  const nextPromise = iter.next();
  // Let the generator progress to session.prompt().
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(promptStarted, true);
  ac.abort();
  promptResolve();

  const { value: terminal } = await nextPromise;
  assert.equal(terminal.type, 'terminal');
  assert.equal(terminal.phase, 'cancelled');
  assert.equal(terminal.partialText, '');
  assert.deepEqual(terminal.toolEvents, []);
});

test('runAgentExecution short-circuits pre-aborted signal WITHOUT creating a session', async () => {
  let sessionCreated = false;
  const ac = new AbortController();
  ac.abort(); // pre-aborted

  const collected = [];
  for await (const ev of runAgentExecution({
    agentConfig: { id: 'a1', name: 't', provider_base_url: 'http://x', model: 'm', provider_api_key: 'k-value' },
    prompt: 'p',
    signal: ac.signal,
    createSession: async () => { sessionCreated = true; return makeFakeSession([]); },
    agentDir: '/tmp/x',
  })) {
    collected.push(ev);
  }

  assert.equal(sessionCreated, false, 'pre-aborted signal must not create a session');
  assert.equal(collected.length, 1);
  assert.equal(collected[0].type, 'terminal');
  assert.equal(collected[0].phase, 'cancelled');
});

test('runAgentExecution yields terminal failed when session.prompt throws', async () => {
  const session = makeFakeSession([], { failPrompt: new Error('provider down') });
  const collected = [];
  for await (const ev of runAgentExecution({
    agentConfig: { id: 'a1', name: 't', provider_base_url: 'http://x', model: 'm', provider_api_key: 'k-value' },
    prompt: 'p',
    createSession: async () => session,
    agentDir: '/tmp/x',
  })) {
    collected.push(ev);
  }

  assert.equal(collected.length, 1);
  assert.equal(collected[0].type, 'terminal');
  assert.equal(collected[0].phase, 'failed');
  assert.equal(collected[0].error.kind, 'provider_error');
  assert.match(collected[0].error.message, /provider down/);
  assert.equal(session._getDisposed(), true, 'session disposed on failure');
});

test('runAgentExecution yields terminal failed when session.prompt rejects with an Error', async () => {
  const session = makeFakeSession([], { failPrompt: 'string error' });
  const collected = [];
  for await (const ev of runAgentExecution({
    agentConfig: { id: 'a1', name: 't', provider_base_url: 'http://x', model: 'm', provider_api_key: 'k-value' },
    prompt: 'p',
    createSession: async () => session,
    agentDir: '/tmp/x',
  })) {
    collected.push(ev);
  }

  assert.equal(collected[0].phase, 'failed');
  assert.equal(collected[0].error.kind, 'provider_error');
});

test('runAgentExecution classifies cancelled (not failed) when signal aborts AND prompt rejects — signal.aborted takes precedence', async () => {
  // Scenario: user cancels mid-run; pi's prompt() rejects in response to the
  // abort. The terminal MUST be "cancelled", not "failed" (#66 rule:
  // classification uses signal.aborted, not event inspection).
  const ac = new AbortController();
  let promptReject;
  const session = {
    subscribe() { return () => {}; },
    async prompt() {
      // Block until the test aborts the signal, then reject (simulating pi
      // surfacing an abort as a provider error).
      await new Promise((_, rej) => { promptReject = rej; });
    },
    async abort() { promptReject?.(new Error('aborted by pi')); },
    agent: { waitForIdle() { return Promise.resolve(); } },
    dispose() {},
  };

  const iter = runAgentExecution({
    agentConfig: { id: 'a1', name: 't', provider_base_url: 'http://x', model: 'm', provider_api_key: 'k-value' },
    prompt: 'p',
    signal: ac.signal,
    createSession: async () => session,
    agentDir: '/tmp/x',
  });

  const nextPromise = iter.next();
  await new Promise((r) => setTimeout(r, 10));
  ac.abort(); // triggers session.abort() → prompt() rejects
  const { value: terminal } = await nextPromise;

  assert.equal(terminal.type, 'terminal');
  assert.equal(terminal.phase, 'cancelled', 'signal.aborted must win over promptError');
});
