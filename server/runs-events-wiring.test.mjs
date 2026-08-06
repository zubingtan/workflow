import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createApp } from './app.mjs';
import { ensureSchema } from './db-schema.mjs';
import { createRunsEventBus } from './runs-events.mjs';

/**
 * Phase 5 (#157): wiring the SSE event bus into app.mjs + REST endpoints.
 *
 * Pins:
 *   - GET /api/workflows/:id/runs/events opens an SSE stream; the initial
 *     :ping flushes headers. Two subscribers on the same workflow both
 *     receive broadcasts.
 *   - GET /api/workflows/:id/runs returns the ordered history list WITHOUT
 *     the heavy report/schema_snapshot columns.
 *   - GET /api/runs/:runID returns the full row with parsed report +
 *     schema_snapshot (null if not yet terminal) + queuePosition.
 *   - DELETE /api/runs/:runID on a queued/running run returns 409
 *     {error:'run_not_terminal'}; on a terminal run returns 200 + {ok:true}.
 *   - Closing a subscriber's stream removes it from the bus (no leak).
 */

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wf-phase5-wire-'));
  const db = new Database(join(dir, 'workflow.db'));
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', ?)").run(
    JSON.stringify({ nodes: [{ id: 'n1', type: 'llm' }], edges: [] })
  );
  return { db, dir };
}

function makeApp(options = {}) {
  const { db, dir } = setupDb();
  const eventBus = createRunsEventBus();
  const app = createApp({ db, agentDir: dir, eventBus, ...options });
  return { app, db, dir, eventBus };
}

const SCHEMA = JSON.stringify({ nodes: [], edges: [] });

// --- GET /api/workflows/:id/runs (history list) ---

test('GET /api/workflows/:id/runs returns ordered list without report/schema_snapshot', async () => {
  const { app, db } = makeApp();
  // Seed three runs: succeeded (oldest), failed, queued (newest).
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at, started_at, ended_at, report, schema_snapshot) VALUES ('run_old', 'wf_1', 'succeeded', datetime('now','-3 hours'), datetime('now','-3 hours'), datetime('now','-3 hours'), ?, ?)"
  ).run(JSON.stringify({ workflowStatus: { success: true } }), SCHEMA);
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at, started_at, ended_at) VALUES ('run_mid', 'wf_1', 'failed', datetime('now','-2 hours'), datetime('now','-2 hours'), datetime('now','-2 hours'))"
  ).run();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_new', 'wf_1', 'queued', datetime('now'))"
  ).run();

  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs'));
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.equal(rows.length, 3);
  // Ordered by queued_at DESC — newest first.
  assert.equal(rows[0].id, 'run_new');
  assert.equal(rows[1].id, 'run_mid');
  assert.equal(rows[2].id, 'run_old');
  // No heavy columns in the list payload.
  for (const row of rows) {
    assert.equal('report' in row, false, 'report excluded from list');
    assert.equal('schema_snapshot' in row, false, 'schema_snapshot excluded from list');
    assert.ok('status' in row);
    assert.ok('queued_at' in row);
  }
});

test('GET /api/workflows/:id/runs returns empty array for a workflow with no runs', async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs'));
  assert.equal(res.status, 200);
  const rows = await res.json();
  assert.deepEqual(rows, []);
});

// --- GET /api/runs/:runID (full detail) ---

test('GET /api/runs/:runID returns full row with parsed report + schema_snapshot for a terminal run', async () => {
  const { app, db } = makeApp();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at, started_at, ended_at, report, schema_snapshot) VALUES ('run_done', 'wf_1', 'succeeded', datetime('now'), datetime('now'), datetime('now'), ?, ?)"
  ).run(
    JSON.stringify({ workflowStatus: { success: true }, outputs: { result: 'ok' } }),
    JSON.stringify({ nodes: [{ id: 'n1', type: 'llm' }] })
  );

  const res = await app.fetch(new Request('http://localhost/api/runs/run_done'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.id, 'run_done');
  assert.equal(body.status, 'succeeded');
  assert.deepEqual(body.report, { workflowStatus: { success: true }, outputs: { result: 'ok' } });
  assert.deepEqual(body.schema_snapshot, { nodes: [{ id: 'n1', type: 'llm' }] });
  assert.equal(body.queuePosition, 0, 'terminal run → position 0');
});

test('GET /api/runs/:runID returns report=null + schema_snapshot=null for a queued run', async () => {
  const { app, db } = makeApp();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_q', 'wf_1', 'queued', datetime('now'))"
  ).run();

  const res = await app.fetch(new Request('http://localhost/api/runs/run_q'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'queued');
  assert.equal(body.report, null);
  assert.equal(body.schema_snapshot, null);
});

test('GET /api/runs/:runID returns 404 for a missing run', async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request('http://localhost/api/runs/run_missing'));
  assert.equal(res.status, 404);
});

// --- DELETE /api/runs/:runID ---

test('DELETE /api/runs/:runID on a terminal run removes the row and returns {ok:true}', async () => {
  const { app, db } = makeApp();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at, ended_at) VALUES ('run_done', 'wf_1', 'succeeded', datetime('now'), datetime('now'))"
  ).run();

  const res = await app.fetch(
    new Request('http://localhost/api/runs/run_done', { method: 'DELETE' })
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const row = db.prepare('SELECT id FROM workflow_runs WHERE id=?').get('run_done');
  assert.equal(row, undefined, 'row deleted');
});

test("DELETE /api/runs/:runID on a queued run returns 409 {error:'run_not_terminal'}", async () => {
  const { app, db } = makeApp();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_q', 'wf_1', 'queued', datetime('now'))"
  ).run();

  const res = await app.fetch(new Request('http://localhost/api/runs/run_q', { method: 'DELETE' }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'run_not_terminal');
  assert.equal(body.status, 'queued');

  // Row NOT deleted.
  const row = db.prepare('SELECT id FROM workflow_runs WHERE id=?').get('run_q');
  assert.ok(row, 'queued run NOT deleted');
});

test('DELETE /api/runs/:runID on a running run returns 409', async () => {
  const { app, db } = makeApp();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at, started_at) VALUES ('run_r', 'wf_1', 'running', datetime('now'), datetime('now'))"
  ).run();

  const res = await app.fetch(new Request('http://localhost/api/runs/run_r', { method: 'DELETE' }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'run_not_terminal');
  assert.equal(body.status, 'running');
});

test('DELETE /api/runs/:runID on a missing run returns 404', async () => {
  const { app } = makeApp();
  const res = await app.fetch(
    new Request('http://localhost/api/runs/run_missing', { method: 'DELETE' })
  );
  assert.equal(res.status, 404);
});

// --- SSE endpoint ---

test('GET /api/workflows/:id/runs/events opens an SSE stream and writes initial :ping + init frame', async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/event-stream');
  assert.equal(res.headers.get('Cache-Control'), 'no-cache');
  assert.equal(res.headers.get('Connection'), 'keep-alive');

  // The bus writes an initial :ping to flush headers, then the endpoint
  // writes an `init` frame with the current active-run IDs (Phase 10 #162)
  // AND activeRuns (#179: per-run report for late-subscriber catch-up).
  // Both may arrive in the same chunk or separate chunks — accumulate text
  // until we've seen both.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(':ping') || !text.includes('"type":"init"')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  assert.ok(text.includes(':ping\n\n'), 'initial :ping flushed headers');
  assert.ok(text.includes('"type":"init"'), 'init frame sent after subscribe');
  assert.ok(
    text.includes('"activeRunIDs":[]'),
    'init frame carries empty activeRunIDs for fresh wf'
  );
  assert.ok(
    text.includes('"activeRuns":[]'),
    '#179 init frame carries empty activeRuns for fresh wf'
  );
  await reader.cancel();
});

test('#179 init frame carries activeRuns with per-run report for running runs (late-subscriber catch-up)', async () => {
  const { db, dir } = setupDb();
  const eventBus = createRunsEventBus();
  // Seed one queued + one running run.
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_q', 'wf_1', 'queued', datetime('now'))"
  ).run();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at, started_at) VALUES ('run_r', 'wf_1', 'running', datetime('now'), datetime('now'))"
  ).run();
  // Fake getRunningReport: returns a per-node report only for run_r.
  const fakeReport = {
    id: 'r',
    workflowStatus: { status: 'processing', terminated: false, startTime: 1, timeCost: 0 },
    reports: {
      nodeA: {
        id: 'nodeA',
        status: 'processing',
        terminated: false,
        startTime: 1,
        timeCost: 0,
        snapshots: [],
      },
    },
    inputs: {},
    outputs: {},
    messages: {},
  };
  const app = createApp({
    db,
    agentDir: dir,
    eventBus,
    getRunningReport: (runID) => (runID === 'run_r' ? fakeReport : null),
  });

  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('"type":"init"')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel();

  // Parse the init frame's data payload.
  const initDataLine = text
    .split('\n')
    .find((l) => l.startsWith('data: ') && l.includes('"type":"init"'));
  assert.ok(initDataLine, 'init frame present');
  const init = JSON.parse(initDataLine.slice('data: '.length));
  assert.deepEqual(init.activeRunIDs, ['run_q', 'run_r'], 'activeRunIDs lists both active runs');
  assert.equal(init.activeRuns.length, 2, 'activeRuns has one entry per active run');
  const qRun = init.activeRuns.find((r) => r.runID === 'run_q');
  const rRun = init.activeRuns.find((r) => r.runID === 'run_r');
  assert.equal(qRun.status, 'queued');
  assert.equal(qRun.report, null, 'queued run has null report (no per-node state yet)');
  assert.equal(rRun.status, 'running');
  assert.deepEqual(
    rRun.report,
    fakeReport,
    'running run carries the cached IReport for late-subscriber catch-up'
  );
});

test('SSE route filters init and events by runID and type', async () => {
  const { app, db, eventBus } = makeApp();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_1', 'wf_1', 'queued', datetime('now'))"
  ).run();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_2', 'wf_1', 'queued', datetime('now'))"
  ).run();

  const res = await app.fetch(
    new Request('http://localhost/api/workflows/wf_1/runs/events?runID=run_1&type=run_progress')
  );
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  await drainInitial(reader);

  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });
  eventBus.broadcast('wf_1', { type: 'run_progress', runID: 'run_2', report: {} });
  eventBus.broadcast('wf_1', { type: 'run_progress', runID: 'run_1', report: { step: 1 } });

  const { value } = await reader.read();
  const text = decoder.decode(value);
  assert.match(text, /"runID":"run_1"/);
  assert.match(text, /"type":"run_progress"/);
  assert.doesNotMatch(text, /run_2/);
  assert.doesNotMatch(text, /run_status/);
  await reader.cancel();
});

test('page SSE route shares one stream across workflows and keeps a global sequence', async () => {
  const { app, db, eventBus } = makeApp();
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_2', 'n2', '{}')").run();
  db.prepare(
    "INSERT INTO workflow_runs (id, workflow_id, status, queued_at) VALUES ('run_2', 'wf_2', 'queued', datetime('now'))"
  ).run();

  const res = await app.fetch(
    new Request('http://localhost/api/runs/events?workflowId=wf_1&workflowId=wf_2')
  );
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let initial = '';
  let initCount = 0;
  while (initCount < 2) {
    const { value, done } = await reader.read();
    if (done) break;
    initial += decoder.decode(value, { stream: true });
    initCount = (initial.match(/"type":"init"/g) ?? []).length;
  }
  assert.equal(initCount, 2, 'one init snapshot per subscribed workflow');

  eventBus.broadcast('wf_2', { type: 'run_status', runID: 'run_2', status: 'running' });
  const first = decoder.decode((await reader.read()).value);
  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });
  const second = decoder.decode((await reader.read()).value);

  assert.match(first, /"workflowId":"wf_2"/);
  assert.match(second, /"workflowId":"wf_1"/);
  assert.match(first, /id: 3/);
  assert.match(second, /id: 4/);
  await reader.cancel();
});

test('page SSE reconnect resumes its sequence from Last-Event-ID', async () => {
  const { app, eventBus } = makeApp();
  const first = await app.fetch(new Request('http://localhost/api/runs/events?workflowId=wf_1'));
  const firstReader = first.body.getReader();
  await drainInitial(firstReader);
  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });
  const firstEvent = new TextDecoder().decode((await firstReader.read()).value);
  assert.match(firstEvent, /id: 2/);
  await firstReader.cancel();

  const reconnected = await app.fetch(
    new Request('http://localhost/api/runs/events?workflowId=wf_1', {
      headers: { 'Last-Event-ID': '2' },
    })
  );
  const reconnectedReader = reconnected.body.getReader();
  let initial = '';
  while (!initial.includes('"type":"init"')) {
    const { value, done } = await reconnectedReader.read();
    if (done) break;
    initial += new TextDecoder().decode(value, { stream: true });
  }
  assert.match(initial, /id: 3/);

  eventBus.broadcast('wf_1', { type: 'run_terminal', runID: 'run_1', status: 'succeeded' });
  const terminal = new TextDecoder().decode((await reconnectedReader.read()).value);
  assert.match(terminal, /id: 4/);
  await reconnectedReader.cancel();
});

test('page SSE reports deleted workflows that disappeared before reconnect', async () => {
  const { app, db } = makeApp();
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_2', 'n2', '{}')").run();

  const res = await app.fetch(
    new Request('http://localhost/api/runs/events?workflowId=wf_1&workflowId=wf_missing')
  );
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('"type":"workflow_deleted"') || !text.includes('"type":"init"')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  assert.match(text, /"type":"workflow_deleted","workflowId":"wf_missing"/);
  assert.match(text, /"type":"init","workflowId":"wf_1"/);
  await reader.cancel();
});

test('page SSE keeps all initial frames for more than 64 workflows', async () => {
  const { app, db } = makeApp();
  const workflowIds = ['wf_1'];
  for (let index = 2; index <= 65; index += 1) {
    const workflowId = `wf_${index}`;
    workflowIds.push(workflowId);
    db.prepare('INSERT INTO workflows (id, name, data) VALUES (?, ?, ?)').run(
      workflowId,
      workflowId,
      '{}'
    );
  }
  const params = new URLSearchParams();
  for (const workflowId of workflowIds) params.append('workflowId', workflowId);

  const res = await app.fetch(new Request(`http://localhost/api/runs/events?${params}`));
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while ((text.match(/"type":"init"/g) ?? []).length < workflowIds.length) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  assert.equal((text.match(/"type":"init"/g) ?? []).length, workflowIds.length);
  await reader.cancel();
});

test('page SSE route requires at least one workflowId', async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request('http://localhost/api/runs/events'));
  assert.equal(res.status, 400);
});

test('SSE route emits heartbeat frames and clears them on cancellation', async () => {
  const { app } = makeApp({ runEventsHeartbeatMs: 5 });
  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  const reader = res.body.getReader();
  await drainInitial(reader);

  const { value } = await reader.read();
  assert.equal(new TextDecoder().decode(value), ':ping\n\n');
  await reader.cancel();
});

test('GET /api/workflows/:id/runs/events returns 404 for a missing workflow', async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_missing/runs/events'));
  assert.equal(res.status, 404);
});

/**
 * Drain the initial SSE frames (:ping + init) so subsequent reads only see
 * real broadcast events. Phase 10 (#162) added the `init` frame after the
 * bus's `:ping`, so tests must consume both before asserting on broadcasts.
 */
async function drainInitial(reader) {
  const decoder = new TextDecoder();
  let seenPing = false;
  let seenInit = false;
  while (!seenPing || !seenInit) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (chunk.includes(':ping')) seenPing = true;
    if (chunk.includes('"type":"init"')) seenInit = true;
  }
}

test('SSE: broadcasting a run_status event reaches the subscriber via the stream', async () => {
  const { app, eventBus } = makeApp();
  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  // Consume the initial :ping + init frame.
  await drainInitial(reader);

  // Broadcast a run_status event.
  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'queued' });

  const { value } = await reader.read();
  const text = decoder.decode(value);
  assert.match(
    text,
    /data: \{"type":"run_status","runID":"run_1","status":"queued","workflowId":"wf_1","sequence":2\}/
  );
  assert.match(text, /id: 2/);
  await reader.cancel();
});

test('SSE: closing the stream unsubscribes (no leak, no EPIPE crash on later broadcast)', async () => {
  const { app, eventBus } = makeApp();
  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  const reader = res.body.getReader();
  await drainInitial(reader);

  // Cancel the stream — simulates the tab closing.
  await reader.cancel();
  // Give the cancel callback a tick to fire.
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(eventBus.subscriberCount('wf_1'), 0, 'subscriber removed after stream cancel');

  // Broadcasting to the now-empty workflow must NOT crash.
  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });
});

test('SSE: multi-tab — two subscribers on the same workflow both receive broadcasts', async () => {
  const { app, eventBus } = makeApp();
  const res1 = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  const res2 = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  const reader1 = res1.body.getReader();
  const reader2 = res2.body.getReader();
  const decoder = new TextDecoder();

  // Consume the initial :ping + init frame on both.
  await drainInitial(reader1);
  await drainInitial(reader2);

  // Broadcast once — both should receive.
  eventBus.broadcast('wf_1', { type: 'run_terminal', runID: 'run_1', status: 'succeeded' });

  const [r1, r2] = await Promise.all([reader1.read(), reader2.read()]);
  const text1 = decoder.decode(r1.value);
  const text2 = decoder.decode(r2.value);
  assert.equal(text1, text2, 'both tabs received identical data');
  assert.ok(text1.includes('run_terminal'), 'event type is run_terminal');

  await reader1.cancel();
  await reader2.cancel();
});

test('SSE: broadcasting to a different workflow does NOT reach this subscriber', async () => {
  const { app, eventBus, db } = makeApp();
  // Seed a second workflow.
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_2', 'n2', '{}')").run();

  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  const reader = res.body.getReader();
  await drainInitial(reader);

  // Broadcast to wf_2 — wf_1 subscriber must NOT receive.
  eventBus.broadcast('wf_2', { type: 'run_status', runID: 'run_1', status: 'queued' });

  // Broadcast to wf_1 — this one should arrive.
  eventBus.broadcast('wf_1', { type: 'run_status', runID: 'run_2', status: 'running' });

  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.ok(text.includes('run_2'), 'received the wf_1 broadcast');
  assert.ok(!text.includes('run_1'), 'did NOT receive the wf_2 broadcast');
  await reader.cancel();
});

test('eventBus absent → SSE endpoint returns 503', async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir }); // no eventBus
  const res = await app.fetch(new Request('http://localhost/api/workflows/wf_1/runs/events'));
  assert.equal(res.status, 503);
});
