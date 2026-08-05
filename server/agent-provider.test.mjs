import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { createApp } from './app.mjs';
import { ensureSchema } from './db-schema.mjs';
import { createAgent, getAgentById } from './agent-catalog.mjs';

function makeApp() {
  const db = new Database(':memory:');
  ensureSchema(db);
  const agent = createAgent(db, {
    name: 'Provider test',
    config: {
      provider: { base_url: 'http://old.example/v1', api_key: 'old', model: 'old' },
      pi_settings: { retry: { enabled: true, maxRetries: 3 }, future: { enabled: true } },
    },
  });
  const app = createApp({
    db,
    agentDir: '/tmp/provider-test-agent',
    providerClient: {
      fetchModels: async () => ({
        models: [
          { id: 'model-a', name: 'Model A', max_input_tokens: 1000 },
          { id: 'model-b', name: 'Model B', max_output_tokens: 500 },
        ],
      }),
      testCompletion: async (provider, { models }) => {
        assert.ok(models.some((model) => model.id === provider.model));
        return { ok: true, model: provider.model };
      },
    },
  });
  return { db, app, agent };
}

async function jsonRequest(app, path, method, body) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

test('Provider tab obtains a model-list token, tests, then saves atomically', async () => {
  const { app, agent, db } = makeApp();
  const provider = { base_url: 'http://new.example/v1', api_key: 'new-key', model: 'model-a' };

  const modelsResponse = await jsonRequest(app, `/agents/${agent.id}/provider/models`, 'POST', {
    provider: { ...provider, model: '' },
  });
  assert.equal(modelsResponse.status, 200);
  const modelsBody = await modelsResponse.json();
  assert.deepEqual(modelsBody.models, [
    { id: 'model-a', name: 'Model A', max_input_tokens: 1000 },
    { id: 'model-b', name: 'Model B', max_output_tokens: 500 },
  ]);
  assert.equal(typeof modelsBody.model_list_token, 'string');

  const testResponse = await jsonRequest(app, `/agents/${agent.id}/provider/test`, 'POST', {
    provider,
    model_list_token: modelsBody.model_list_token,
  });
  assert.equal(testResponse.status, 200);
  const testBody = await testResponse.json();
  assert.equal(testBody.ok, true);
  assert.equal(typeof testBody.test_token, 'string');

  const saveResponse = await jsonRequest(app, `/agents/${agent.id}/provider`, 'PUT', {
    provider,
    test_token: testBody.test_token,
  });
  assert.equal(saveResponse.status, 200);
  const saved = JSON.parse(getAgentById(db, agent.id).config);
  assert.deepEqual(saved.provider, provider);
  assert.deepEqual(saved.pi_settings, {
    retry: { enabled: true, maxRetries: 3 },
    future: { enabled: true },
  });
});

test('Provider save rejects a missing or stale test token without changing config', async () => {
  const { app, agent, db } = makeApp();
  const provider = { base_url: 'http://new.example/v1', api_key: 'new-key', model: 'model-a' };

  const missing = await jsonRequest(app, `/agents/${agent.id}/provider`, 'PUT', {
    provider,
    test_token: 'not-a-token',
  });
  assert.equal(missing.status, 409);
  assert.match((await missing.json()).code, /provider_test_required/);
  assert.equal(JSON.parse(getAgentById(db, agent.id).config).provider.model, 'old');
});

test('Provider routes reject incomplete required fields before invoking the provider client', async () => {
  const { app, agent, db } = makeApp();
  const response = await jsonRequest(app, `/agents/${agent.id}/provider/models`, 'POST', {
    provider: { base_url: '', api_key: '', model: '' },
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, 'provider_invalid');
  assert.equal(JSON.parse(getAgentById(db, agent.id).config).provider.model, 'old');
});

test('generic Agent updates cannot bypass the Provider test gate', async () => {
  const { app, agent, db } = makeApp();
  const response = await jsonRequest(app, `/agents/${agent.id}`, 'PUT', {
    config: {
      provider: { base_url: 'http://bypass.example/v1', api_key: 'key', model: 'model-a' },
    },
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'provider_test_required');
  assert.equal(JSON.parse(getAgentById(db, agent.id).config).provider.model, 'old');
});
