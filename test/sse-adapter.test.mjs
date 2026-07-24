import assert from 'node:assert/strict';
import test from 'node:test';

import { projectTerminal } from '../server/agent-execution.mjs';
import { createRunAgentSse } from '../server/sse-adapter.mjs';

/**
 * projectTerminal maps a shared-module terminal event to the SSE event shape
 * the browser consumes. Verified independently of the Hono stream.
 */
test('projectTerminal: succeeded → {type:"finish"}', () => {
  assert.deepEqual(
    projectTerminal({ type: 'terminal', phase: 'succeeded', partialText: 'x', toolEvents: [] }),
    { type: 'finish' },
  );
});

test('projectTerminal: cancelled → {type:"cancelled"} (additive event for browser)', () => {
  assert.deepEqual(
    projectTerminal({ type: 'terminal', phase: 'cancelled', partialText: 'x', toolEvents: [] }),
    { type: 'cancelled' },
  );
});

test('projectTerminal: failed → {type:"error", message, kind}', () => {
  assert.deepEqual(
    projectTerminal({
      type: 'terminal', phase: 'failed', partialText: '', toolEvents: [],
      error: { kind: 'provider_error', message: 'upstream 500' },
    }),
    { type: 'error', message: 'upstream 500', kind: 'provider_error' },
  );
});

test('projectTerminal: failed without error object → generic provider_error', () => {
  assert.deepEqual(
    projectTerminal({ type: 'terminal', phase: 'failed', partialText: '', toolEvents: [] }),
    { type: 'error', message: 'Agent Execution failed', kind: 'provider_error' },
  );
});

/**
 * Build a runAgentSse handler whose streamSSE is a fake that drives the given
 * fakeStream. This is the injectable seam: tests pass `streamSSE: fakeStreamer`
 * into createRunAgentSse, the factory binds it, and the handler calls the fake
 * streamer instead of hono/streaming's real one.
 *
 * Each test supplies its own `fakeStream` (with a `_written` accumulator) and
 * asserts against `fakeStream._written` directly — no separate capture helper
 * needed.
 */
function makeRunAgentSseWithFakeStream({ runAgentExecution, environment, fakeStream }) {
  const fakeStreamer = async (_c, handler) => handler(fakeStream);
  return createRunAgentSse({
    runAgentExecution,
    createAgentSessionForAgent: async () => { throw new Error('must not be called — fakeRun ignores createSession'); },
    agentDir: '/tmp/x',
    environment,
    streamSSE: fakeStreamer,
  });
}

/** Minimal fake Hono context for the streaming tests (header() only). */
function fakeContext() {
  return { _headers: {}, header(k, v) { this._headers[k] = v; }, req: { param: () => undefined } };
}

/** Minimal fake stream that captures written SSE events into `_written`. */
function fakeStream() {
  return {
    aborted: false,
    onAbort(_cb) {},
    async writeSSE(msg) { this._written ??= []; this._written.push(msg.data ? JSON.parse(msg.data) : msg); },
  };
}

const AGENT = { id: 'a1', name: 't', provider_base_url: 'http://x', model: 'm', provider_api_key_env: 'K' };

test('SSE adapter: streams content_delta + tool events, then finish on succeeded terminal', async () => {
  async function* fakeRun() {
    yield { type: 'content_delta', content: 'Hi' };
    yield { type: 'content_delta', content: ' there' };
    yield { type: 'tool_start', toolName: 'read', args: {} };
    yield { type: 'tool_end', toolName: 'read', result: 'r', isError: false };
    yield { type: 'terminal', phase: 'succeeded', partialText: 'Hi there', toolEvents: [] };
  }
  const stream = fakeStream();
  const runAgentSse = makeRunAgentSseWithFakeStream({
    runAgentExecution: fakeRun, environment: { K: 'secret' }, fakeStream: stream,
  });
  await runAgentSse(fakeContext(), AGENT, 'hi');
  const written = stream._written ?? [];
  assert.deepEqual(written.map((e) => e.type), ['content_delta', 'content_delta', 'tool_start', 'tool_end', 'finish']);
  assert.equal(written[0].content, 'Hi');
  assert.equal(written[4].type, 'finish');
});

test('SSE adapter: emits {type:"cancelled"} on cancelled terminal (additive event)', async () => {
  async function* fakeRun() {
    yield { type: 'content_delta', content: 'partial' };
    yield { type: 'terminal', phase: 'cancelled', partialText: 'partial', toolEvents: [] };
  }
  const stream = fakeStream();
  const runAgentSse = makeRunAgentSseWithFakeStream({
    runAgentExecution: fakeRun, environment: { K: 'secret' }, fakeStream: stream,
  });
  await runAgentSse(fakeContext(), AGENT, 'hi');
  const written = stream._written ?? [];
  assert.deepEqual(written.map((e) => e.type), ['content_delta', 'cancelled']);
});

test('SSE adapter: emits {type:"error", message, kind} on failed terminal', async () => {
  async function* fakeRun() {
    yield { type: 'terminal', phase: 'failed', partialText: '', toolEvents: [],
      error: { kind: 'provider_error', message: 'boom' } };
  }
  const stream = fakeStream();
  const runAgentSse = makeRunAgentSseWithFakeStream({
    runAgentExecution: fakeRun, environment: { K: 'secret' }, fakeStream: stream,
  });
  await runAgentSse(fakeContext(), AGENT, 'hi');
  const written = stream._written ?? [];
  assert.deepEqual(written, [{ type: 'error', message: 'boom', kind: 'provider_error' }]);
});

test('SSE adapter: missing env var → 500 JSON before streaming (route-level credential check)', async () => {
  async function* fakeRun() { yield { type: 'terminal', phase: 'succeeded', partialText: '', toolEvents: [] }; }
  // The credential short-circuit returns c.json(...) BEFORE streamSSE is called,
  // so the fake streamer is never invoked.
  const fakeStreamer = async () => { throw new Error('streamSSE should not be called on missing env var'); };
  const runAgentSse = createRunAgentSse({
    runAgentExecution: fakeRun,
    createAgentSessionForAgent: async () => { throw new Error('not called'); },
    agentDir: '/tmp/x',
    environment: {}, // no API key for this agent
    streamSSE: fakeStreamer,
  });
  const c = {
    _headers: {},
    _json: null,
    _status: null,
    header(k, v) { this._headers[k] = v; },
    json(body, status) { this._json = body; this._status = status; return { _jsonResponse: true }; },
    req: { param: () => undefined, json: async () => ({ prompt: 'hi' }) },
  };
  await runAgentSse(
    c,
    { id: 'a1', name: 't', provider_base_url: 'http://x', model: 'm', provider_api_key_env: 'MISSING_K' },
    'hi',
  );
  assert.equal(c._status, 500);
  assert.match(c._json.error, /MISSING_K/);
});
