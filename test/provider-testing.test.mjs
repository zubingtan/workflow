import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchProviderModels, testProviderCompletion } from '../server/provider-testing.mjs';

const provider = {
  base_url: 'http://provider.example/v1',
  api_key: 'secret-key',
  model: 'model-2',
};

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('fetchProviderModels reads the OpenAI-compatible model list', async () => {
  const calls = [];
  const result = await fetchProviderModels(provider, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, {
        data: [
          { id: 'model-1', object: 'model' },
          { id: 'model-2', object: 'model' },
        ],
      });
    },
  });

  assert.deepEqual(
    result.models.map(({ id }) => id),
    ['model-1', 'model-2']
  );
  assert.equal(result.models[0].object, 'model');
  assert.equal(calls[0].url, 'http://provider.example/v1/models');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-key');
});

test('fetchProviderModels normalizes Open WebUI model metadata without exposing internal info', async () => {
  const result = await fetchProviderModels(provider, {
    fetchImpl: async () =>
      response(200, {
        data: [
          {
            id: 'deepseek-v4-flash',
            name: 'DeepSeek V4 Flash',
            object: 'model',
            created: 1677610602,
            owned_by: 'openai',
            connection_type: 'external',
            max_input_tokens: 1_000_000,
            max_output_tokens: 384_000,
            info: {
              user_id: 'must-not-leak',
              meta: {
                description: null,
                capabilities: { vision: false, code_interpreter: true },
                builtinTools: { memory: true },
                filterIds: ['move_reasoning_effort_to_extra_body'],
              },
            },
            tags: [{ name: 'litellm' }],
          },
        ],
      }),
  });

  assert.deepEqual(result.models, [
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      object: 'model',
      created: 1677610602,
      owned_by: 'openai',
      connection_type: 'external',
      max_input_tokens: 1_000_000,
      max_output_tokens: 384_000,
      capabilities: { vision: false, code_interpreter: true },
      builtin_tools: { memory: true },
      filter_ids: ['move_reasoning_effort_to_extra_body'],
      tags: ['litellm'],
    },
  ]);
});

test('testProviderCompletion sends a minimal request without tools', async () => {
  const calls = [];
  const result = await testProviderCompletion(provider, {
    models: ['model-1', 'model-2'],
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, {
        choices: [{ message: { content: 'OK' } }],
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'http://provider.example/v1/chat/completions');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'model-2');
  assert.equal(body.stream, false);
  assert.equal('tools' in body, false);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'Reply with OK.' }]);
});

test('testProviderCompletion rejects a model that was not returned by the provider', async () => {
  await assert.rejects(
    () =>
      testProviderCompletion(provider, {
        models: ['model-1'],
        fetchImpl: async () => response(200, {}),
      }),
    /model-2.*model list/i
  );
});
