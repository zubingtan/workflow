import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  AgentCatalogError,
  listAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  copyAgent,
  seedAgentIfEmpty,
} from '../server/agent-catalog.mjs';
import { ensureSchema } from '../server/db-schema.mjs';

function makeDb() {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

const validFields = {
  name: 'Test Agent',
  config: {
    provider: { base_url: 'http://localhost:4010/v1', api_key: 'fake-key', model: 'fake-model' },
    system_prompt: 'You are helpful.',
    session_options: {},
    pi_settings: { defaultProjectTrust: 'always' },
  },
};

test('createAgent persists and returns row with config JSON', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  assert.equal(agent.name, 'Test Agent');
  assert.equal(agent.runtime, 'pi-coding-agent');
  assert.equal(typeof agent.id, 'string');
  const config = JSON.parse(agent.config);
  assert.equal(config.provider.model, 'fake-model');
  assert.equal(config.system_prompt, 'You are helpful.');
});

test('createAgent defaults name to Untitled', () => {
  const db = makeDb();
  const agent = createAgent(db, {});
  assert.equal(agent.name, 'Untitled');
});

test('listAgents returns rows ordered by created_at DESC', () => {
  const db = makeDb();
  createAgent(db, { ...validFields, name: 'A' });
  createAgent(db, { ...validFields, name: 'B' });
  const list = listAgents(db);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((r) => r.name).sort(), ['A', 'B']);
});

test('getAgentById returns the row or undefined for missing', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  assert.equal(getAgentById(db, agent.id).name, 'Test Agent');
  assert.equal(getAgentById(db, 'nope'), undefined);
});

test('updateAgent patches name', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  const updated = updateAgent(db, agent.id, { name: 'Renamed' });
  assert.equal(updated.name, 'Renamed');
});

test('updateAgent merges config JSON (shallow per layer)', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  const updated = updateAgent(db, agent.id, { config: { provider: { model: 'new-model' } } });
  const config = JSON.parse(updated.config);
  assert.equal(config.provider.model, 'new-model');
  assert.equal(config.provider.base_url, 'http://localhost:4010/v1'); // preserved
  assert.equal(config.system_prompt, 'You are helpful.'); // preserved
});

test('updateAgent recursively merges nested config and preserves unknown fields', () => {
  const db = makeDb();
  const agent = createAgent(db, {
    ...validFields,
    config: {
      ...validFields.config,
      pi_settings: {
        defaultProjectTrust: 'always',
        retry: { enabled: true, maxRetries: 3 },
        futureSetting: { enabled: true },
      },
    },
  });

  const updated = updateAgent(db, agent.id, {
    config: { pi_settings: { retry: { enabled: false } } },
  });
  const config = JSON.parse(updated.config);

  assert.equal(config.pi_settings.retry.enabled, false);
  assert.equal(config.pi_settings.retry.maxRetries, 3);
  assert.deepEqual(config.pi_settings.futureSetting, { enabled: true });
});

test('updateAgent replaces tags', () => {
  const db = makeDb();
  const agent = createAgent(db, { ...validFields, tags: ['a'] });
  const updated = updateAgent(db, agent.id, { tags: ['b', 'c'] });
  assert.deepEqual(JSON.parse(updated.tags), ['b', 'c']);
});

test('updateAgent returns undefined for missing id', () => {
  const db = makeDb();
  assert.equal(updateAgent(db, 'nope', { name: 'X' }), undefined);
});

test('deleteAgent returns true on hit, false on miss', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  assert.equal(deleteAgent(db, agent.id), true);
  assert.equal(deleteAgent(db, agent.id), false);
});

test('deleteAgent throws workflow_reference when workflow references agent', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  // Create a workflow that references this agent
  db.prepare('INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)').run(
    'wf1',
    'Test WF',
    JSON.stringify({ nodes: [{ data: { agentId: agent.id } }] })
  );
  assert.throws(
    () => deleteAgent(db, agent.id),
    (err) => err instanceof AgentCatalogError && err.code === 'workflow_reference'
  );
});

test('copyAgent clones with "(copy)" name suffix and new id', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  const copy = copyAgent(db, agent.id);
  assert.equal(copy.name, 'Test Agent (copy)');
  assert.notEqual(copy.id, agent.id);
  assert.equal(copy.config, agent.config);
});

test('copyAgent returns undefined for missing source', () => {
  const db = makeDb();
  assert.equal(copyAgent(db, 'nope'), undefined);
});

test('seedAgentIfEmpty inserts when table empty, no-op when non-empty', () => {
  const db = makeDb();
  const seeded = seedAgentIfEmpty(db, { id: 'fake-default', ...validFields });
  assert.equal(seeded.name, 'Test Agent');
  assert.equal(listAgents(db).length, 1);

  const result = seedAgentIfEmpty(db, { ...validFields, id: 'should-not-insert' });
  assert.equal(result, undefined);
  assert.equal(listAgents(db).length, 1);
});
