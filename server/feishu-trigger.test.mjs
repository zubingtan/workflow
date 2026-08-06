import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createApp } from './app.mjs';
import { ensureSchema } from './db-schema.mjs';
import { withFeishuStartOutputs } from './feishu-trigger-handler.mjs';

const SCHEMA = JSON.stringify({
  nodes: [
    {
      id: 'start_0',
      type: 'start',
      data: {
        outputs: { type: 'object', properties: { query: { type: 'string' } } },
      },
    },
    {
      id: 'feishu_trigger_1',
      type: 'feishu-trigger',
      data: {
        enabled: true,
        appId: 'cli_a',
        appSecret: 'secret',
        onlyWhenMentioned: true,
        chatIdAllowlist: '',
        contextMode: 'auto',
        maxMessages: 20,
        windowMinutes: 30,
      },
    },
  ],
  edges: [],
});

function setupApp() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-feishu-trigger-'));
  const db = new Database(join(dir, 'workflow.db'));
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_feishu', 'Feishu', ?)").run(
    SCHEMA
  );
  const enqueues = [];
  const app = createApp({
    db,
    agentDir: dir,
    enqueueRun: (workflowId, runID, payload) => enqueues.push({ workflowId, runID, payload }),
  });
  return { app, db, enqueues };
}

function feishuEvent(messageId = 'om_1') {
  return {
    header: {
      token: 'token_1',
      event_id: 'evt_1',
      event_type: 'im.message.receive_v1',
      tenant_key: 'tenant_1',
    },
    event: {
      sender: {
        sender_type: 'user',
        sender_id: { user_id: 'u_1', open_id: 'ou_1' },
      },
      message: {
        message_id: messageId,
        root_id: 'om_root',
        chat_id: 'oc_1',
        chat_type: 'group',
        message_type: 'text',
        create_time: '1710000000000',
        content: JSON.stringify({ text: '@_user_1 分析一下这段讨论' }),
        mentions: [{ key: '@_user_1', mentioned_type: 'bot', name: 'bot' }],
      },
    },
  };
}

async function postEvent(app, body) {
  return app.fetch(
    new Request('http://localhost/api/feishu/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

test('Feishu receive-message event fetches context and enqueues the configured workflow', async () => {
  const { app, db, enqueues } = setupApp();
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  process.env.FEISHU_EVENT_VERIFICATION_TOKEN = 'token_1';
  globalThis.fetch = async (url) => {
    if (String(url).includes('tenant_access_token')) {
      return Response.json({ code: 0, tenant_access_token: 'token_1' });
    }
    return Response.json({
      code: 0,
      data: {
        items: [
          {
            message_id: 'om_reply',
            create_time: '1710000001000',
            msg_type: 'text',
            sender: { sender_type: 'user', sender_id: { user_id: 'u_2' } },
            body: { content: JSON.stringify({ text: '前面的讨论内容' }) },
          },
        ],
      },
    });
  };

  try {
    const res = await postEvent(app, feishuEvent());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'queued');
    assert.ok(body.runID);
    assert.equal(enqueues.length, 1);
    assert.equal(enqueues[0].workflowId, 'wf_feishu');
    const enqueuedSchema = JSON.parse(enqueues[0].payload.schema);
    assert.notEqual(enqueues[0].payload.schema, SCHEMA);
    assert.equal(enqueuedSchema.nodes[0].data.outputs.properties.chatId.type, 'string');
    assert.equal(enqueuedSchema.nodes[0].data.outputs.properties.contextText.type, 'string');
    assert.equal(enqueuedSchema.nodes[0].data.outputs.properties.contextFetchError.type, 'string');
    assert.equal(enqueues[0].payload.inputs.query, '分析一下这段讨论');
    assert.equal(enqueues[0].payload.inputs.chatId, 'oc_1');
    assert.equal(enqueues[0].payload.inputs.feishuTriggerNodeId, 'feishu_trigger_1');
    assert.match(enqueues[0].payload.inputs.contextText, /前面的讨论内容/);

    const dedup = db.prepare("SELECT run_id FROM feishu_event_dedup WHERE message_id='om_1'").get();
    assert.equal(dedup.run_id, body.runID);
  } finally {
    process.env = oldEnv;
    globalThis.fetch = oldFetch;
  }
});

test('withFeishuStartOutputs preserves existing Start outputs and adds Feishu inputs', () => {
  const schema = {
    nodes: [
      {
        id: 'start_0',
        type: 'start',
        data: {
          outputs: {
            type: 'object',
            properties: { query: { type: 'string', default: 'Hello' } },
          },
        },
      },
    ],
    edges: [],
  };

  const transformed = withFeishuStartOutputs(schema);
  assert.notEqual(transformed, schema);
  assert.deepEqual(schema.nodes[0].data.outputs.properties, {
    query: { type: 'string', default: 'Hello' },
  });
  assert.equal(transformed.nodes[0].data.outputs.properties.query.default, 'Hello');
  assert.equal(transformed.nodes[0].data.outputs.properties.chatId.type, 'string');
  assert.equal(transformed.nodes[0].data.outputs.properties.contextText.type, 'string');
  assert.equal(transformed.nodes[0].data.outputs.properties.feishuTriggerNodeId.type, 'string');
});

test('Feishu receive-message event is idempotent by message_id', async () => {
  const { app, enqueues } = setupApp();
  const oldEnv = { ...process.env };
  process.env.FEISHU_EVENT_VERIFICATION_TOKEN = 'token_1';

  try {
    const first = await postEvent(app, feishuEvent('om_dup'));
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    assert.equal(firstBody.status, 'queued');

    const second = await postEvent(app, feishuEvent('om_dup'));
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.duplicate, true);
    assert.equal(secondBody.runID, firstBody.runID);
    assert.equal(enqueues.length, 1);
  } finally {
    process.env = oldEnv;
  }
});

test('Feishu receive-message event ignores messages without a matching trigger node', async () => {
  const { app, db, enqueues } = setupApp();
  const oldEnv = { ...process.env };
  process.env.FEISHU_EVENT_VERIFICATION_TOKEN = 'token_1';

  db.prepare('DELETE FROM workflows WHERE id=?').run('wf_feishu');
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_other', 'Other', ?)").run(
    JSON.stringify({ nodes: [], edges: [] })
  );

  try {
    const res = await postEvent(app, feishuEvent('om_no_trigger'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ignored, true);
    assert.equal(body.reason, 'no_matching_feishu_trigger');
    const row = db
      .prepare("SELECT message_id FROM feishu_event_dedup WHERE message_id='om_no_trigger'")
      .get();
    assert.equal(row, undefined);
    assert.equal(enqueues.length, 0);
  } finally {
    process.env = oldEnv;
  }
});

test('Feishu trigger node chat allowlist filters incoming events', async () => {
  const { app, db, enqueues } = setupApp();
  const oldEnv = { ...process.env };
  process.env.FEISHU_EVENT_VERIFICATION_TOKEN = 'token_1';

  const schema = JSON.parse(SCHEMA);
  schema.nodes.find((node) => node.type === 'feishu-trigger').data.chatIdAllowlist = 'oc_allowed';
  db.prepare('UPDATE workflows SET data=? WHERE id=?').run(JSON.stringify(schema), 'wf_feishu');

  try {
    const res = await postEvent(app, feishuEvent('om_denied_chat'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ignored, true);
    assert.equal(body.reason, 'no_matching_feishu_trigger');
    assert.equal(enqueues.length, 0);
  } finally {
    process.env = oldEnv;
  }
});

test('Feishu long-connection events only match trigger nodes for the same app id', async () => {
  const { db, enqueues } = setupApp();
  const schema = JSON.parse(SCHEMA);
  schema.nodes.find((node) => node.type === 'feishu-trigger').data.appId = 'cli_b';
  db.prepare('UPDATE workflows SET data=? WHERE id=?').run(JSON.stringify(schema), 'wf_feishu');

  const { handleFeishuReceiveMessage } = await import('./feishu-trigger-handler.mjs');
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('tenant_access_token')) {
      return Response.json({ code: 0, tenant_access_token: 'token_1' });
    }
    return Response.json({ code: 0, data: { items: [] } });
  };

  try {
    const wrongApp = await handleFeishuReceiveMessage({
      db,
      appId: 'cli_a',
      payload: feishuEvent('om_wrong_app'),
      enqueueSavedWorkflowRun: ({ workflowId, schema: workflowSchema, inputs }) => {
        enqueues.push({ workflowId, payload: { schema: workflowSchema, inputs } });
        return { runID: 'run_wrong_app', schema: workflowSchema };
      },
    });
    assert.equal(wrongApp.ignored, true);
    assert.equal(wrongApp.reason, 'no_matching_feishu_trigger');
    assert.equal(enqueues.length, 0);

    const result = await handleFeishuReceiveMessage({
      db,
      appId: 'cli_b',
      payload: feishuEvent('om_right_app'),
      enqueueSavedWorkflowRun: ({ workflowId, schema: workflowSchema, inputs }) => {
        db.prepare(
          "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, 'queued', datetime('now'))"
        ).run('run_right_app', workflowId);
        enqueues.push({ workflowId, payload: { schema: workflowSchema, inputs } });
        return { runID: 'run_right_app', schema: workflowSchema };
      },
    });

    assert.equal(result.status, 'queued');
    assert.equal(enqueues.length, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
