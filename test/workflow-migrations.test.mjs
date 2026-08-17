import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { ensureSchema } from '../server/db-schema.mjs';
import { migrateDefaultWorkflow, migrateWorkflowData } from '../server/workflow-migrations.mjs';

function makeDb() {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

test('migrateWorkflowData converts legacy LLM inputs to the agent contract', () => {
  const data = {
    nodes: [
      {
        id: 'llm_main',
        type: 'llm',
        data: {
          inputsValues: {
            modelName: { type: 'constant', content: 'fake-m0' },
            apiHost: { type: 'constant', content: 'http://localhost:4853/v1' },
            prompt: { type: 'template', content: 'classify {{start_0.query}}' },
          },
          outputs: { type: 'object', properties: { result: { type: 'string' } } },
        },
      },
    ],
  };

  const result = migrateWorkflowData(data, 'fake-default');
  const llm = result.data.nodes[0].data;

  assert.equal(result.changed, true);
  assert.deepEqual(llm.inputsValues.agentId, {
    type: 'constant',
    content: 'fake-default',
  });
  assert.deepEqual(llm.inputsValues.prompt, {
    type: 'template',
    content: 'classify {{start_0.query}}',
  });
  assert.deepEqual(llm.inputs.required, ['agentId', 'prompt']);
  assert.equal(llm.inputs.properties.agentId.extra.formComponent, 'agent-select');
  assert.equal(llm.inputs.properties.prompt.extra.formComponent, 'prompt-editor');
  // Unknown node fields and the declared output contract remain intact.
  assert.equal(llm.outputs.properties.result.type, 'string');
  assert.equal('modelName' in llm.inputsValues, false);
  assert.equal('apiHost' in llm.inputsValues, false);
});

test('migrateWorkflowData fills empty agent IDs but does not overwrite custom agents', () => {
  const data = {
    nodes: [
      {
        id: 'llm_empty',
        type: 'llm',
        data: {
          inputsValues: {
            agentId: { type: 'constant', content: '' },
            prompt: { type: 'template', content: 'one' },
          },
        },
      },
      {
        id: 'llm_custom',
        type: 'llm',
        data: {
          inputsValues: {
            agentId: { type: 'constant', content: 'my-agent' },
            prompt: { type: 'template', content: 'two' },
          },
        },
      },
    ],
  };

  const result = migrateWorkflowData(data, 'fake-default');
  assert.equal(result.data.nodes[0].data.inputsValues.agentId.content, 'fake-default');
  assert.equal(result.data.nodes[1].data.inputsValues.agentId.content, 'my-agent');
});

test('migrateDefaultWorkflow updates only the named default workflow', () => {
  const db = makeDb();
  db.prepare('INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)').run(
    'default-id',
    'Default Workflow',
    JSON.stringify({
      nodes: [
        {
          id: 'llm_main',
          type: 'llm',
          data: {
            inputsValues: {
              agentId: { type: 'constant', content: '' },
              prompt: { type: 'template', content: 'hello' },
            },
          },
        },
      ],
    })
  );
  db.prepare('INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)').run(
    'other-id',
    'Other Workflow',
    JSON.stringify({ nodes: [] })
  );

  assert.deepEqual(migrateDefaultWorkflow(db, 'default-agent'), {
    changed: true,
    workflowId: 'default-id',
  });
  const migrated = JSON.parse(
    db.prepare('SELECT data FROM workflows WHERE id=?').get('default-id').data
  );
  assert.equal(migrated.nodes[0].data.inputsValues.agentId.content, 'default-agent');
  assert.deepEqual(migrateDefaultWorkflow(db, 'default-agent'), {
    changed: false,
    workflowId: 'default-id',
  });
  assert.deepEqual(
    JSON.parse(db.prepare('SELECT data FROM workflows WHERE id=?').get('other-id').data),
    { nodes: [] }
  );
});
