import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentExecutor, AgentExecutionError } from '../server/runtime-adapter.mjs';

/**
 * Phase 9 (#161): per-node execution timeout via a per-node AbortController
 * in AgentExecutor.execute.
 *
 * Pins #140 (EXECUTOR-PROMISE-RACE) + #66 (signal.aborted precedence):
 *   - A node whose runAgentExecution never resolves must be aborted by the
 *     timeout, classified as `failed` with `kind:'timeout'` and
 *     `detail.reason:'node_timeout'`.
 *   - When the WORKFLOW signal aborts (user cancel) BEFORE the timeout fires,
 *     classification stays `cancelled` (terminated) — timeout must NOT
 *     misclassify a user cancel as a timeout failure.
 *   - The per-node AbortController's abort triggers the shared module's
 *     signal.aborted bridge, which calls the awaitable `session.abort()`
 *     (#66 lesson). The executor does not own the session.
 *
 * The shared `runAgentExecution` is injected (fake) so no pi session is
 * involved. The fake simulates "provider never returns" by yielding nothing
 * and never settling its prompt — the only way out is the timeout firing.
 */

function makeNeverResolvingRunAgentExecution({ trackAborts = false } = {}) {
  const aborts = [];
  async function* fakeRunAgentExecution({ signal }) {
    // Simulate a provider call that never returns normally. When the signal
    // aborts (timeout or cancel), yield a `cancelled` terminal — mirroring
    // the real shared module's signal.aborted short-circuit path
    // (agent-execution.mjs:140-143). Without this, the generator would hang
    // forever and the executor's drain loop couldn't observe the abort.
    const aborted = new Promise((resolve) => {
      if (signal) {
        signal.addEventListener('abort', () => {
          if (trackAborts) aborts.push(true);
          resolve();
        }, { once: true });
      }
    });
    await aborted;
    yield { type: 'terminal', phase: 'cancelled', partialText: '', toolEvents: [] };
  }
  return { fakeRunAgentExecution, aborts };
}

function makeAgent() {
  return { id: 'a1', provider_api_key: 'secret' };
}

function makeDb() {
  return { prepare: () => ({ get: () => makeAgent() }) };
}

test('node timeout fires when runAgentExecution never resolves → throws AgentExecutionError kind=timeout', async () => {
  const { fakeRunAgentExecution, aborts } = makeNeverResolvingRunAgentExecution({ trackAborts: true });
  const executor = createAgentExecutor({
    db: makeDb(),
    agentDir: '/tmp/x',
    runAgentExecution: fakeRunAgentExecution,
    // Short timeout for the test — 50ms.
    resolveTimeoutMs: () => 50,
  });

  await assert.rejects(
    () => executor.execute({
      inputs: { agentId: 'a1', prompt: 'p' },
      signal: new AbortController().signal,
      node: { data: {} },
    }),
    (err) => {
      assert.ok(err instanceof AgentExecutionError, 'should be AgentExecutionError');
      assert.equal(err.kind, 'timeout', 'kind must be timeout');
      assert.equal(err.detail?.reason, 'node_timeout', 'detail.reason must be node_timeout');
      assert.match(err.message, /50ms/);
      return true;
    },
  );
  // The combined signal must have aborted (proving the per-node AbortController fired).
  assert.equal(aborts.length, 1, 'combined signal should have aborted exactly once');
});

test('node timeout respects node.data.timeoutOverride when present', async () => {
  // Use a fake that records the timeout it observed by resolving only after
  // the signal aborts (i.e. the timeout firing). We assert the wait time is
  // closer to the override (30ms) than the default (10min).
  const start = Date.now();
  const { fakeRunAgentExecution } = makeNeverResolvingRunAgentExecution();
  const executor = createAgentExecutor({
    db: makeDb(),
    agentDir: '/tmp/x',
    runAgentExecution: fakeRunAgentExecution,
    resolveTimeoutMs: (node) => node?.data?.timeoutOverride ?? 10 * 60 * 1000,
  });

  await assert.rejects(
    () => executor.execute({
      inputs: { agentId: 'a1', prompt: 'p' },
      signal: new AbortController().signal,
      node: { data: { timeoutOverride: 30 } },
    }),
    (err) => {
      assert.equal(err.kind, 'timeout');
      assert.equal(err.detail?.reason, 'node_timeout');
      return true;
    },
  );
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 25 && elapsed < 500, `elapsed ${elapsed}ms should be ~30ms (override), not 10min (default)`);
});

test('user cancel (workflow signal abort) BEFORE timeout → returns normally with terminated:"cancelled" (NOT timeout)', async () => {
  // Fake that yields a cancelled terminal when the combined signal aborts —
  // simulating the shared module's signal.aborted short-circuit path.
  async function* fakeCancelledOnAbort({ signal }) {
    if (signal?.aborted) {
      yield { type: 'terminal', phase: 'cancelled', partialText: '', toolEvents: [] };
      return;
    }
    // Wait for the signal to abort, then yield cancelled terminal.
    await new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
    yield { type: 'terminal', phase: 'cancelled', partialText: 'partial', toolEvents: [] };
  }

  const executor = createAgentExecutor({
    db: makeDb(),
    agentDir: '/tmp/x',
    runAgentExecution: fakeCancelledOnAbort,
    resolveTimeoutMs: () => 10000, // 10s — long enough that cancel wins
  });

  const workflowSignal = new AbortController();
  const execPromise = executor.execute({
    inputs: { agentId: 'a1', prompt: 'p' },
    signal: workflowSignal.signal,
    node: { data: {} },
  });
  // Cancel after 30ms — well before the 10s timeout.
  setTimeout(() => workflowSignal.abort(), 30);

  const result = await execPromise;
  assert.deepEqual(result, {
    outputs: {
      result: 'partial',
      _executionDetail: { toolEvents: [], terminated: 'cancelled' },
    },
  });
});

test('node timeout=0 means no timeout (runAgentExecution may take forever — but here it succeeds)', async () => {
  // timeoutOverride=0 is treated as "no timeout" per spec ("No timeout" option).
  async function* fakeSucceed({ signal }) {
    yield { type: 'content_delta', content: 'hi' };
    yield { type: 'terminal', phase: 'succeeded', partialText: 'hi', toolEvents: [] };
  }
  const executor = createAgentExecutor({
    db: makeDb(),
    agentDir: '/tmp/x',
    runAgentExecution: fakeSucceed,
    resolveTimeoutMs: (node) => node?.data?.timeoutOverride ?? 10 * 60 * 1000,
  });

  const result = await executor.execute({
    inputs: { agentId: 'a1', prompt: 'p' },
    signal: new AbortController().signal,
    node: { data: { timeoutOverride: 0 } },
  });
  assert.equal(result.outputs.result, 'hi');
});

test('resolveTimeoutMs precedence: node.data.timeoutOverride > settings > env > default', async () => {
  // This is a unit test of the precedence — we drive it through the executor
  // by observing which timeout actually fires.
  const cases = [
    { node: { data: { timeoutOverride: 20 } }, settings: null, env: null, expected: 20 },
    { node: { data: {} }, settings: 30, env: null, expected: 30 },
    { node: { data: {} }, settings: null, env: '40', expected: 40 },
    { node: { data: {} }, settings: null, env: null, expected: 10 * 60 * 1000 },
    // timeoutOverride=0 means "no timeout" → resolveTimeoutMs returns 0.
    { node: { data: { timeoutOverride: 0 } }, settings: 30, env: null, expected: 0 },
    // timeoutOverride=null also means "no timeout" (No timeout option) — spec §5.
    { node: { data: { timeoutOverride: null } }, settings: 30, env: null, expected: 0 },
    // timeoutOverride=undefined falls through to settings (use-global-default).
    { node: { data: { timeoutOverride: undefined } }, settings: 30, env: null, expected: 30 },
  ];

  for (const { node, settings, env, expected } of cases) {
    const origEnv = process.env.NODE_TIMEOUT_MS;
    if (env === null) delete process.env.NODE_TIMEOUT_MS;
    else process.env.NODE_TIMEOUT_MS = env;

    const executor = createAgentExecutor({
      db: makeDb(),
      agentDir: '/tmp/x',
      runAgentExecution: async function* () { yield { type: 'terminal', phase: 'succeeded', partialText: '', toolEvents: [] }; },
      settingsProvider: settings != null ? { getNodeTimeoutDefaultMs: () => settings } : null,
    });

    // For expected=0 (no timeout) we just verify it succeeds. For others,
    // we verify the value via a separate direct call.
    if (expected === 0) {
      const result = await executor.execute({
        inputs: { agentId: 'a1', prompt: 'p' },
        signal: new AbortController().signal,
        node,
      });
      assert.equal(result.outputs.result, '');
    }

    // Direct precedence check.
    const resolved = executor.resolveTimeoutMs(node, settings != null ? { getNodeTimeoutDefaultMs: () => settings } : null);
    assert.equal(resolved, expected, `expected ${expected} for node=${JSON.stringify(node)} settings=${settings} env=${env}`);

    if (origEnv === undefined) delete process.env.NODE_TIMEOUT_MS;
    else process.env.NODE_TIMEOUT_MS = origEnv;
  }
});
