import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { createApp } from './app.mjs';
import { ensureSchema } from './db-schema.mjs';
import { createRunQueue } from './queue.mjs';
import { createCapturingOnTerminal } from './queue-adapter.mjs';
import { createRunsEventBus } from './runs-events.mjs';
import { createSseTestHarness } from './sse-test-harness.mjs';

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-sse-harness-'));
  const db = new Database(join(dir, 'workflow.db'));
  ensureSchema(db);
  db.prepare('INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)').run(
    'wf_1',
    'isolated workflow',
    JSON.stringify({ nodes: [{ id: 'n1', type: 'llm' }], edges: [] }),
  );
  return { db, dir };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('timed out waiting for test condition');
}

test('SSE test harness reports isolated connection counts', () => {
  const eventBus = createRunsEventBus();
  const harness = createSseTestHarness({ eventBus });

  const wf1Connection = harness.connect('wf_1');
  const wf2Connection = harness.connect('wf_2');

  assert.equal(harness.connectionCount(), 2);
  assert.equal(harness.connectionCount('wf_1'), 1);
  assert.equal(harness.connectionCount('wf_2'), 1);

  wf1Connection.close();
  assert.equal(harness.connectionCount(), 1);

  wf2Connection.close();
  assert.equal(harness.connectionCount(), 0);
});

test('SSE test harness reproduces delayed, duplicated, and reordered events', async () => {
  const eventBus = createRunsEventBus();
  const received = [];
  const harness = createSseTestHarness({ eventBus });
  const connection = harness.connect('wf_1', {
    onEvent: (event) => received.push(event),
    faults: { delayMs: 1, duplicate: 1, reorder: true },
  });

  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'queued' });
  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });
  await connection.flush();

  assert.deepEqual(
    received.map((event) => event.status),
    ['running', 'running', 'queued', 'queued'],
  );
  connection.close();
});

test('SSE test harness can drop terminal events and force a broken connection', () => {
  const eventBus = createRunsEventBus();
  const received = [];
  const harness = createSseTestHarness({ eventBus });
  const connection = harness.connect('wf_1', {
    onEvent: (event) => received.push(event),
    faults: { drop: (event) => event.type === 'run_terminal' },
  });

  eventBus.broadcast('wf_1', { type: 'run_progress', runID: 'run_1', report: {} });
  eventBus.broadcast('wf_1', { type: 'run_terminal', runID: 'run_1', status: 'succeeded' });

  assert.deepEqual(
    received.map((event) => event.type),
    ['run_progress'],
  );
  assert.equal(harness.connectionCount('wf_1'), 1);

  connection.break();
  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });
  assert.equal(harness.connectionCount('wf_1'), 0);
  harness.close();
});

test('SSE test harness exposes EventSource callbacks for reconnect tests', () => {
  const eventBus = createRunsEventBus();
  const harness = createSseTestHarness({ eventBus });
  const source = harness.createEventSource('wf_1');
  const messages = [];
  let errors = 0;
  source.onmessage = (event) => messages.push(JSON.parse(event.data));
  source.onerror = () => {
    errors++;
  };

  eventBus.broadcast('wf_1', { type: 'run_progress', runID: 'run_1', report: {} });
  assert.equal(messages.length, 1);

  source.connection.break();
  eventBus.broadcast('wf_1', { type: 'run_terminal', runID: 'run_1', status: 'succeeded' });
  assert.equal(errors, 1);
  assert.equal(harness.connectionCount('wf_1'), 0);

  source.close();
  assert.equal(source.readyState, source.CLOSED);
});

test('queue publisher remains recoverable through REST when terminal SSE is dropped', async () => {
  const { db, dir } = setupDb();
  const eventBus = createRunsEventBus();
  const events = [];
  const harness = createSseTestHarness({ eventBus });
  const connection = harness.connect('wf_1', {
    onEvent: (event) => events.push(event),
    faults: { drop: (event) => event.type === 'run_terminal' },
  });
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_1', 'wf_1', 'queued', datetime('now'))",
  ).run();

  const app = createApp({ db, agentDir: dir, eventBus });
  const report = {
    workflowStatus: { status: 'succeeded', terminated: true },
    outputs: { result: 'ok' },
  };
  const queue = createRunQueue({
    db,
    runTask: () => ({ taskID: 'task_1', done: Promise.resolve({ status: 'succeeded' }) }),
    cancelTask: async () => ({ success: true }),
    onTerminal: createCapturingOnTerminal(db, async () => report, eventBus),
    onEvent: (workflowId, event) => eventBus.broadcast(workflowId, event),
  });

  try {
    queue.enqueue('wf_1', 'run_1', { schema: '{}', inputs: {} });
    await waitFor(
      () =>
        db.prepare('SELECT status FROM workflow_runs WHERE id=?').get('run_1')?.status ===
        'succeeded',
    );
    await connection.flush();

    assert.deepEqual(
      events.map((event) => event.type),
      ['run_status', 'run_status'],
      'queued and running publisher events are still delivered',
    );

    const response = await app.fetch(new Request('http://localhost/api/runs/run_1'));
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.status, 'succeeded');
    assert.deepEqual(snapshot.report, report);
    assert.deepEqual(snapshot.schema_snapshot, {
      nodes: [{ id: 'n1', type: 'llm' }],
      edges: [],
    });
  } finally {
    queue.dispose();
    connection.close();
    db.close();
  }
});
