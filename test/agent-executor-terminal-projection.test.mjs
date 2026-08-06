import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentExecutor, AgentExecutionError } from '../server/runtime-adapter.mjs';

const STRUCTURED_NODE = {
  data: { outputs: { type: 'object', properties: { result: { type: 'string' } } } },
};

/**
 * Injects a scripted `runAgentExecution` that yields the given terminal event
 * (plus optional non-terminal events before it). Asserts the executor's
 * projection per #77: succeeded → return with _executionDetail.toolEvents;
 * cancelled → return normally with terminated:"cancelled"; failed → throw
 * AgentExecutionError. No pi session involved.
 */
function makeExecutor(scriptedEvents) {
  async function* fakeRunAgentExecution() {
    for (const ev of scriptedEvents) yield ev;
  }
  return createAgentExecutor({
    db: { prepare: () => ({ get: () => ({ id: 'a1', provider_api_key: 'secret' }) }) },
    agentDir: '/tmp/x',
    createSession: async () => { throw new Error('createSession must not be called when runAgentExecution is injected'); },
    runAgentExecution: fakeRunAgentExecution,
  });
}

test('task adapter projects terminal succeeded → return with _executionDetail.toolEvents', async () => {
  const executor = makeExecutor([
    { type: 'content_delta', content: 'Hello' },
    { type: 'tool_start', toolName: 'read', args: { path: '/a' } },
    { type: 'tool_end', toolName: 'read', result: 'c', isError: false },
    { type: 'terminal', phase: 'succeeded', partialText: 'Hello', toolEvents: [
      { type: 'tool_start', toolName: 'read', args: { path: '/a' } },
      { type: 'tool_end', toolName: 'read', result: 'c', isError: false },
    ] },
  ]);
  const out = await executor.execute({ inputs: { agentId: 'a1', prompt: 'p' }, node: STRUCTURED_NODE });
  assert.deepEqual(out, {
    outputs: {
      result: 'Hello',
      _executionDetail: {
        toolEvents: [
          { type: 'tool_start', toolName: 'read', args: { path: '/a' } },
          { type: 'tool_end', toolName: 'read', result: 'c', isError: false },
        ],
      },
    },
  });
});

test('task adapter projects terminal cancelled → return normally (NO throw) with terminated:"cancelled"', async () => {
  const executor = makeExecutor([
    { type: 'content_delta', content: 'partial' },
    { type: 'terminal', phase: 'cancelled', partialText: 'partial', toolEvents: [] },
  ]);
  const out = await executor.execute({ inputs: { agentId: 'a1', prompt: 'p' }, node: STRUCTURED_NODE });
  assert.deepEqual(out, {
    outputs: {
      result: 'partial',
      _executionDetail: { toolEvents: [], terminated: 'cancelled' },
    },
  });
});

test('task adapter projects terminal failed → throws AgentExecutionError from terminal.error', async () => {
  const executor = makeExecutor([
    { type: 'terminal', phase: 'failed', partialText: '', toolEvents: [],
      error: { kind: 'provider_error', message: 'upstream 500' } },
  ]);
  await assert.rejects(
    () => executor.execute({ inputs: { agentId: 'a1', prompt: 'p' }, node: STRUCTURED_NODE }),
    (err) => {
      assert.ok(err instanceof AgentExecutionError, 'should be AgentExecutionError');
      assert.equal(err.kind, 'provider_error');
      assert.equal(err.message, 'upstream 500');
      return true;
    },
  );
});

test('task adapter pre-checks throw agent_not_found when agentId missing', async () => {
  const executor = makeExecutor([]); // runAgentExecution never called
  await assert.rejects(
    () => executor.execute({ inputs: { prompt: 'p' } }),
    (err) => {
      assert.ok(err instanceof AgentExecutionError);
      assert.equal(err.kind, 'agent_not_found');
      return true;
    },
  );
});

test('task adapter pre-checks throw agent_not_found when prompt missing', async () => {
  const executor = makeExecutor([]);
  await assert.rejects(
    () => executor.execute({ inputs: { agentId: 'a1' } }),
    (err) => { assert.equal(err.kind, 'agent_not_found'); return true; },
  );
});

test('task adapter pre-checks throw agent_not_found when agent row missing', async () => {
  const executor = createAgentExecutor({
    db: { prepare: () => ({ get: () => null }) },
    agentDir: '/tmp/x',
    runAgentExecution: async function* () { yield { type: 'terminal', phase: 'succeeded', partialText: '', toolEvents: [] }; },
  });
  await assert.rejects(
    () => executor.execute({ inputs: { agentId: 'ghost', prompt: 'p' } }),
    (err) => { assert.equal(err.kind, 'agent_not_found'); return true; },
  );
});

test('task adapter converts iterable-without-terminal to internal_error (defensive)', async () => {
  const executor = makeExecutor([
    { type: 'content_delta', content: 'x' }, // no terminal follows
  ]);
  await assert.rejects(
    () => executor.execute({ inputs: { agentId: 'a1', prompt: 'p' }, node: STRUCTURED_NODE }),
    (err) => { assert.equal(err.kind, 'internal_error'); return true; },
  );
});

test('task adapter converts shared-module throw (non-AgentExecutionError) to internal_error (defensive)', async () => {
  const executor = createAgentExecutor({
    db: { prepare: () => ({ get: () => ({ id: 'a1', provider_api_key: 'secret' }) }) },
    agentDir: '/tmp/x',
    runAgentExecution: async function* () { throw new Error('shared module bug'); },
  });
  await assert.rejects(
    () => executor.execute({ inputs: { agentId: 'a1', prompt: 'p' }, node: STRUCTURED_NODE }),
    (err) => { assert.equal(err.kind, 'internal_error'); return true; },
  );
});
