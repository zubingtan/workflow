import assert from 'node:assert/strict';
import test from 'node:test';

import { TaskCancelAPI, TaskRunAPI, registerNodeExecutor } from '@flowgram.ai/runtime-js';

const workflowSchema = JSON.stringify({
  nodes: [
    {
      id: 'start',
      type: 'start',
      meta: { position: { x: 0, y: 0 } },
      data: { outputs: { type: 'object', properties: {} } },
    },
    {
      id: 'llm',
      type: 'llm',
      meta: { position: { x: 1, y: 0 } },
      data: {
        inputsValues: {},
        inputs: { type: 'object', properties: {} },
        outputs: { type: 'object', properties: { result: { type: 'string' } } },
      },
    },
    {
      id: 'end',
      type: 'end',
      meta: { position: { x: 2, y: 0 } },
      data: {
        inputsValues: {},
        inputs: { type: 'object', properties: {} },
      },
    },
  ],
  edges: [
    { sourceNodeID: 'start', targetNodeID: 'llm' },
    { sourceNodeID: 'llm', targetNodeID: 'end' },
  ],
});

test('TaskCancel aborts the signal received by the active LLM executor', async (t) => {
  let start;
  const started = new Promise((resolve) => {
    start = resolve;
  });
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });

  registerNodeExecutor({
    type: 'llm',
    async execute(context) {
      start(context);
      await released;
      return { outputs: { result: 'finished' } };
    },
  });
  t.after(() => release());

  const { taskID } = await TaskRunAPI({ schema: workflowSchema, inputs: {} });
  const context = await started;

  assert.ok(context.signal, 'custom executors receive a cancellation signal');
  assert.equal(context.signal.aborted, false);

  assert.deepEqual(await TaskCancelAPI({ taskID }), { success: true });
  assert.equal(context.signal.aborted, true);
});
