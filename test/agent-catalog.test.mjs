import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  AgentCatalogError,
  validateTemperature,
  validateProviderApiKeyEnv,
  listAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  copyAgent,
  seedAgentIfEmpty,
} from '../server/agent-catalog.mjs';

/**
 * In-memory SQLite fixture. Mirrors the agents schema from server/index.mjs
 * so the catalog module operates against the real table shape.
 */
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_base_url TEXT NOT NULL,
      provider_api_key_env TEXT NOT NULL,
      model TEXT NOT NULL,
      system_prompt TEXT DEFAULT '',
      temperature REAL DEFAULT 0.7,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  return db;
}

const validFields = {
  name: 'Test Agent',
  provider_base_url: 'http://localhost:4010/v1',
  provider_api_key_env: 'FAKE_PROVIDER_API_KEY',
  model: 'fake-model',
  system_prompt: 'You are helpful.',
  temperature: 0.5,
};

test('createAgent persists all fields and returns the row with default temperature when omitted', () => {
  const db = makeDb();
  const { temperature, ...withoutTemp } = validFields;
  const agent = createAgent(db, withoutTemp);
  assert.equal(agent.name, 'Test Agent');
  assert.equal(agent.temperature, 0.7); // default
  assert.equal(agent.system_prompt, 'You are helpful.');
  assert.equal(typeof agent.id, 'string');
  assert.equal(agent.id.length > 0, true);
});

test('createAgent validates temperature range', () => {
  const db = makeDb();
  for (const bad of [-0.1, 2.1, NaN, 'hot', null]) {
    assert.throws(
      () => createAgent(db, { ...validFields, temperature: bad }),
      (err) => err instanceof AgentCatalogError && err.code === 'invalid_temperature',
      `expected invalid_temperature for temperature=${String(bad)}`,
    );
  }
});

test('validateTemperature accepts undefined (default applies) and rejects invalid', () => {
  // undefined → no throw (caller applies default)
  assert.doesNotThrow(() => validateTemperature(undefined));
  for (const ok of [0, 0.7, 1.5, 2]) {
    assert.doesNotThrow(() => validateTemperature(ok), `expected ok for temperature=${ok}`);
  }
  for (const bad of [-0.1, 2.1, NaN, 'hot', null, true, false]) {
    assert.throws(
      () => validateTemperature(bad),
      (err) => err instanceof AgentCatalogError && err.code === 'invalid_temperature',
      `expected invalid_temperature for temperature=${String(bad)}`,
    );
  }
});

test('validateProviderApiKeyEnv accepts valid names and rejects invalid', () => {
  // undefined → no throw (caller checks required-ness)
  assert.doesNotThrow(() => validateProviderApiKeyEnv(undefined));
  for (const ok of ['FAKE_PROVIDER_API_KEY', 'A', 'ABC_123', 'KEY_URL_HOST']) {
    assert.doesNotThrow(() => validateProviderApiKeyEnv(ok), `expected ok for name=${ok}`);
  }
  for (const bad of ['lower', 'snake_case', '1ABC', 'A-B', '', ' ', 123, true, null]) {
    assert.throws(
      () => validateProviderApiKeyEnv(bad),
      (err) => err instanceof AgentCatalogError && err.code === 'invalid_provider_api_key_env',
      `expected invalid_provider_api_key_env for name=${String(bad)}`,
    );
  }
});

test('createAgent rejects invalid provider_api_key_env via catalog validation', () => {
  const db = makeDb();
  assert.throws(
    () => createAgent(db, { ...validFields, provider_api_key_env: 'lower_case' }),
    (err) => err instanceof AgentCatalogError && err.code === 'invalid_provider_api_key_env',
  );
});

test('updateAgent rejects invalid provider_api_key_env when provided', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  assert.throws(
    () => updateAgent(db, agent.id, { provider_api_key_env: 'lower' }),
    (err) => err instanceof AgentCatalogError && err.code === 'invalid_provider_api_key_env',
  );
});

test('credential boundary: agent rows never store the API key value, only the env-var name', () => {
  // #55 decision / AGENTS.md credential convention: the agents table schema
  // has a `provider_api_key_env` column (the NAME of an env var) and must NOT
  // have any column that stores the key value itself. This test pins that
  // invariant so a future schema change can't silently reintroduce it.
  const db = makeDb();
  const agent = createAgent(db, validFields);
  const columns = Object.keys(agent);
  assert.equal(columns.includes('provider_api_key_env'), true);
  // No column whose name suggests a stored key value.
  for (const forbidden of ['api_key', 'provider_api_key', 'apikey', 'secret', 'token']) {
    assert.equal(columns.includes(forbidden), false, `agents table must not have a '${forbidden}' column`);
  }
});

test('createAgent accepts boundary temperatures 0, 0.7, 2', () => {
  const db = makeDb();
  for (const ok of [0, 0.7, 2, 1.5]) {
    const agent = createAgent(db, { ...validFields, name: `T-${ok}`, temperature: ok });
    assert.equal(agent.temperature, ok);
  }
});

test('listAgents returns rows ordered by created_at DESC', () => {
  const db = makeDb();
  const a = createAgent(db, { ...validFields, name: 'A' });
  const b = createAgent(db, { ...validFields, name: 'B' });
  const list = listAgents(db);
  assert.equal(list.length, 2);
  // both created in the same second by default — order by created_at DESC then
  // the most recently inserted should be first (rowid tiebreak via SQLite).
  assert.deepEqual(list.map((r) => r.name).sort(), ['A', 'B']);
});

test('getAgentById returns the row or undefined for missing', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  assert.equal(getAgentById(db, agent.id).name, 'Test Agent');
  assert.equal(getAgentById(db, 'nope'), undefined);
});

test('updateAgent patches provided fields and validates temperature', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  const updated = updateAgent(db, agent.id, { name: 'Renamed', temperature: 1.2 });
  assert.equal(updated.name, 'Renamed');
  assert.equal(updated.temperature, 1.2);
  assert.equal(updated.model, validFields.model); // unchanged

  assert.throws(
    () => updateAgent(db, agent.id, { temperature: 5 }),
    (err) => err instanceof AgentCatalogError && err.code === 'invalid_temperature',
  );

  // undefined fields are ignored (not treated as null)
  const untouched = updateAgent(db, agent.id, {});
  assert.equal(untouched.name, 'Renamed');
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

test('copyAgent clones with "(copy)" name suffix and new id', () => {
  const db = makeDb();
  const agent = createAgent(db, validFields);
  const copy = copyAgent(db, agent.id);
  assert.equal(copy.name, 'Test Agent (copy)');
  assert.notEqual(copy.id, agent.id);
  assert.equal(copy.model, agent.model);
  assert.equal(copy.temperature, agent.temperature);
  assert.equal(copy.system_prompt, agent.system_prompt);
});

test('copyAgent returns undefined for missing source', () => {
  const db = makeDb();
  assert.equal(copyAgent(db, 'nope'), undefined);
});

test('seedAgentIfEmpty inserts when table empty, no-op when non-empty', () => {
  const db = makeDb();
  // empty → seed
  const seeded = seedAgentIfEmpty(db, {
    id: 'fake-default',
    name: 'Fake Provider',
    provider_base_url: 'http://localhost:4010/v1',
    provider_api_key_env: 'FAKE_PROVIDER_API_KEY',
    model: 'fake-model',
    system_prompt: 'You are a helpful assistant.',
    temperature: 0.7,
  });
  assert.equal(seeded.name, 'Fake Provider');
  assert.equal(listAgents(db).length, 1);

  // non-empty → no-op, returns undefined
  const result = seedAgentIfEmpty(db, { ...validFields, id: 'should-not-insert' });
  assert.equal(result, undefined);
  assert.equal(listAgents(db).length, 1);
});
