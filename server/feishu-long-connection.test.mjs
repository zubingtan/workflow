import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { ensureSchema } from './db-schema.mjs';
import {
  createFeishuLongConnection,
  createFeishuLongConnectionManager,
} from './feishu-long-connection.mjs';

const SCHEMA = JSON.stringify({
  nodes: [
    {
      id: 'feishu_trigger_1',
      type: 'feishu-trigger',
      data: {
        enabled: true,
        appId: 'cli_a',
        appSecret: 'secret',
        onlyWhenMentioned: true,
        contextMode: 'auto',
        maxMessages: 20,
        windowMinutes: 30,
      },
    },
  ],
  edges: [],
});

function schemaFor(appId, appSecret = 'secret') {
  return JSON.stringify({
    nodes: [
      {
        id: `trigger_${appId}`,
        type: 'feishu-trigger',
        data: {
          enabled: true,
          appId,
          appSecret,
          onlyWhenMentioned: true,
          contextMode: 'auto',
          maxMessages: 20,
          windowMinutes: 30,
        },
      },
    ],
    edges: [],
  });
}

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-feishu-ws-'));
  const db = new Database(join(dir, 'workflow.db'));
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_feishu', 'Feishu', ?)").run(
    SCHEMA
  );
  return db;
}

test('Feishu long connection dispatches receive-message events into workflow queue', async () => {
  const db = setupDb();
  const enqueues = [];
  let registered;
  const sdk = {
    LoggerLevel: { info: 'info' },
    WSClient: class {
      constructor(config) {
        this.config = config;
      }
      start({ eventDispatcher }) {
        registered = eventDispatcher.handlers['im.message.receive_v1'];
      }
    },
    EventDispatcher: class {
      constructor() {
        this.handlers = {};
      }
      register(handlers) {
        this.handlers = handlers;
        return this;
      }
    },
  };
  const fetchImpl = async (url) => {
    if (String(url).includes('tenant_access_token')) {
      return Response.json({ code: 0, tenant_access_token: 'tenant_token' });
    }
    return Response.json({ code: 0, data: { items: [] } });
  };

  const connection = createFeishuLongConnection({
    appId: 'cli_a',
    appSecret: 'secret',
    db,
    fetchImpl,
    sdk,
    logger: { info() {}, error() {} },
    enqueueSavedWorkflowRun: ({ workflowId, schema, inputs }) => {
      const runID = 'run_1';
      db.prepare(
        "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES (?, ?, 'queued', datetime('now'))"
      ).run(runID, workflowId);
      enqueues.push({ workflowId, schema, inputs });
      return { runID, schema };
    },
  });

  connection.start();
  await registered({
    sender: { sender_type: 'user', sender_id: { user_id: 'u_1' } },
    message: {
      message_id: 'om_ws',
      chat_id: 'oc_1',
      chat_type: 'group',
      message_type: 'text',
      create_time: '1710000000000',
      content: JSON.stringify({ text: '@_user_1 分析长连接消息' }),
      mentions: [{ key: '@_user_1', mentioned_type: 'bot' }],
    },
  });

  assert.equal(enqueues.length, 1);
  assert.equal(enqueues[0].workflowId, 'wf_feishu');
  assert.equal(enqueues[0].inputs.query, '分析长连接消息');
  assert.equal(enqueues[0].inputs.chatId, 'oc_1');
});

test('Feishu long connection manager starts one client per unique trigger app', async () => {
  const db = setupDb();
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_same', 'Same', ?)").run(
    schemaFor('cli_a')
  );
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_other', 'Other', ?)").run(
    schemaFor('cli_b')
  );
  const started = [];
  const sdk = {
    LoggerLevel: { info: 'info' },
    WSClient: class {
      constructor(config) {
        this.config = config;
      }
      start() {
        started.push(this.config.appId);
      }
    },
    EventDispatcher: class {
      register(handlers) {
        this.handlers = handlers;
        return this;
      }
    },
  };

  const manager = createFeishuLongConnectionManager({
    db,
    sdk,
    logger: { info() {}, error() {} },
    enqueueSavedWorkflowRun() {},
  });

  await manager.refresh();
  assert.deepEqual(started.sort(), ['cli_a', 'cli_b']);
  assert.equal(manager.activeConnectionCount, 2);
});

test('Feishu long connection manager refreshes when workflow trigger config changes', async () => {
  const db = setupDb();
  const started = [];
  const closed = [];
  const sdk = {
    LoggerLevel: { info: 'info' },
    WSClient: class {
      constructor(config) {
        this.config = config;
      }
      start() {
        started.push(this.config.appId);
      }
      close() {
        closed.push(this.config.appId);
      }
    },
    EventDispatcher: class {
      register(handlers) {
        this.handlers = handlers;
        return this;
      }
    },
  };

  const manager = createFeishuLongConnectionManager({
    db,
    sdk,
    logger: { info() {}, error() {} },
    enqueueSavedWorkflowRun() {},
  });

  await manager.refresh();
  assert.deepEqual(started, ['cli_a']);

  db.prepare('UPDATE workflows SET data=? WHERE id=?').run(schemaFor('cli_b'), 'wf_feishu');
  await manager.refresh();

  assert.deepEqual(started, ['cli_a', 'cli_b']);
  assert.deepEqual(closed, ['cli_a']);
  assert.equal(manager.activeConnectionCount, 1);
});
