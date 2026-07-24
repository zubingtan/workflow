import assert from 'node:assert/strict';
import test from 'node:test';

import { createAgentExecutor } from '../server/runtime-adapter.mjs';

test('LLM executor aborts and disposes its Pi session when FlowGram cancels', async () => {
  const agent = {
    id: 'agent_1',
    provider_api_key_env: 'TEST_PROVIDER_API_KEY',
  };
  let start;
  const started = new Promise((resolve) => {
    start = resolve;
  });
  let settle;
  const settled = new Promise((resolve) => {
    settle = resolve;
  });
  let aborts = 0;
  let unsubscribed = false;
  let disposed = false;
  const session = {
    subscribe() {
      return () => {
        unsubscribed = true;
      };
    },
    async prompt() {
      start();
    },
    async abort() {
      aborts += 1;
      settle();
    },
    agent: {
      waitForIdle() {
        return settled;
      },
    },
    dispose() {
      disposed = true;
    },
  };
  const signal = new AbortController();
  const executor = createAgentExecutor({
    db: { prepare: () => ({ get: () => agent }) },
    agentDir: '/tmp/workflow-agent-executor-test',
    createSession: async () => session,
    environment: { TEST_PROVIDER_API_KEY: 'test-only' },
  });

  const execution = executor.execute({
    inputs: { agentId: agent.id, prompt: 'run' },
    signal: signal.signal,
  });
  await started;
  signal.abort();
  const result = await execution;

  assert.equal(aborts, 1);
  assert.equal(unsubscribed, true);
  assert.equal(disposed, true);
  // #77: cancelled terminal projects to a normal return (NO throw) with _executionDetail.terminated:"cancelled"
  assert.deepEqual(result, {
    outputs: {
      result: '',
      _executionDetail: { toolEvents: [], terminated: 'cancelled' },
    },
  });
});
