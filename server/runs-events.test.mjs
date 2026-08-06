import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunsEventBus, createSseEventQueue } from './runs-events.mjs';

/**
 * Phase 5 (#157): SSE event bus unit tests.
 *
 * The bus is framework-agnostic — it works with any `res` object that has
 * `.write(chunk)`. A fake `res` captures writes in an array for assertions.
 * `.setHeader` is optional (Node ServerResponse has it; ReadableStream
 * adapters don't).
 */

function makeFakeRes() {
  const writes = [];
  const headers = {};
  return {
    writes,
    headers,
    write(chunk) {
      writes.push(chunk);
      return true;
    },
    setHeader(name, value) {
      headers[name] = value;
    },
  };
}

test('subscribe sets SSE headers and writes initial :ping', () => {
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe('wf_1', res);
  assert.equal(res.headers['Content-Type'], 'text/event-stream');
  assert.equal(res.headers['Cache-Control'], 'no-cache');
  assert.equal(res.headers['Connection'], 'keep-alive');
  assert.equal(res.writes[0], ':ping\n\n');
});

test('broadcast writes SSE-formatted data to all subscribers of that workflow', () => {
  const bus = createRunsEventBus();
  const res1 = makeFakeRes();
  const res2 = makeFakeRes();
  bus.subscribe('wf_1', res1);
  bus.subscribe('wf_1', res2);
  // Clear initial ping writes.
  res1.writes.length = 0;
  res2.writes.length = 0;

  bus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'queued' });

  assert.equal(res1.writes.length, 1);
  assert.equal(res2.writes.length, 1);
  assert.equal(
    res1.writes[0],
    `data: ${JSON.stringify({
      type: 'run_status',
      runID: 'run_1',
      status: 'queued',
      workflowId: 'wf_1',
      sequence: 1,
    })}\nid: 1\n\n`
  );
  assert.equal(res1.writes[0], res2.writes[0]);
});

test('broadcast assigns a monotonic sequence per workflow', () => {
  const bus = createRunsEventBus();
  const wf1 = makeFakeRes();
  const wf2 = makeFakeRes();
  bus.subscribe('wf_1', wf1);
  bus.subscribe('wf_2', wf2);
  wf1.writes.length = 0;
  wf2.writes.length = 0;

  bus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'queued' });
  bus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });
  bus.broadcast('wf_2', { type: 'run_status', runID: 'run_2', status: 'queued' });

  assert.match(wf1.writes[0], /"sequence":1/);
  assert.match(wf1.writes[0], /id: 1/);
  assert.match(wf1.writes[1], /"sequence":2/);
  assert.match(wf1.writes[1], /id: 2/);
  assert.match(wf2.writes[0], /"sequence":1/);
  assert.match(wf2.writes[0], /id: 1/);
});

test('subscription filters run IDs and event types before delivery', () => {
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe('wf_1', res, {
    runIDs: ['run_1'],
    types: ['run_progress'],
  });
  res.writes.length = 0;

  bus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });
  bus.broadcast('wf_1', { type: 'run_progress', runID: 'run_2', report: {} });
  bus.broadcast('wf_1', { type: 'run_progress', runID: 'run_1', report: {} });

  assert.equal(res.writes.length, 1);
  assert.match(res.writes[0], /"runID":"run_1"/);
  assert.match(res.writes[0], /"type":"run_progress"/);
});

test('broadcast to a workflow does NOT reach subscribers of a different workflow', () => {
  const bus = createRunsEventBus();
  const res1 = makeFakeRes();
  const res2 = makeFakeRes();
  bus.subscribe('wf_1', res1);
  bus.subscribe('wf_2', res2);
  res1.writes.length = 0;
  res2.writes.length = 0;

  bus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'queued' });

  assert.equal(res1.writes.length, 1, 'wf_1 subscriber received event');
  assert.equal(res2.writes.length, 0, 'wf_2 subscriber did NOT receive event');
});

test('broadcast removes dead subscribers (EPIPE) without crashing', () => {
  const bus = createRunsEventBus();
  const aliveRes = makeFakeRes();
  const deadRes = {
    write() {
      throw new Error('write EPIPE');
    },
    setHeader() {},
  };
  bus.subscribe('wf_1', aliveRes);
  bus.subscribe('wf_1', deadRes);
  aliveRes.writes.length = 0;

  bus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'running' });

  assert.equal(aliveRes.writes.length, 1, 'alive subscriber still received event');
  assert.equal(bus.subscriberCount('wf_1'), 1, 'dead subscriber removed from Set');
});

test('unsubscribe removes subscriber and deletes empty Set', () => {
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe('wf_1', res);
  assert.equal(bus.subscriberCount('wf_1'), 1);

  bus.unsubscribe('wf_1', res);
  assert.equal(bus.subscriberCount('wf_1'), 0, 'unsubscribed');

  // Broadcasting to a workflow with no subscribers is a no-op.
  bus.broadcast('wf_1', { type: 'run_status', runID: 'run_1', status: 'queued' });
});

test('broadcastAll with a workflowId only sends to that workflow', () => {
  const bus = createRunsEventBus();
  const res1 = makeFakeRes();
  const res2 = makeFakeRes();
  const res3 = makeFakeRes();
  bus.subscribe('wf_1', res1);
  bus.subscribe('wf_2', res2);
  bus.subscribe('wf_3', res3);
  res1.writes.length = 0;
  res2.writes.length = 0;
  res3.writes.length = 0;

  bus.broadcastAll({ type: 'workflow_deleted', workflowId: 'wf_1' });

  assert.equal(res1.writes.length, 1, 'wf_1 subscriber received broadcastAll');
  assert.equal(res2.writes.length, 0, 'wf_2 subscriber did not receive wf_1 deletion');
  assert.equal(res3.writes.length, 0, 'wf_3 subscriber did not receive wf_1 deletion');
  assert.match(
    res1.writes[0],
    /data: \{"type":"workflow_deleted","workflowId":"wf_1","sequence":1\}/
  );
  assert.match(res1.writes[0], /id: 1/);
});

test('multi-tab: two subscribers on same workflow both receive broadcasts', () => {
  const bus = createRunsEventBus();
  const tab1 = makeFakeRes();
  const tab2 = makeFakeRes();
  bus.subscribe('wf_1', tab1);
  bus.subscribe('wf_1', tab2);
  tab1.writes.length = 0;
  tab2.writes.length = 0;

  bus.broadcast('wf_1', { type: 'run_terminal', runID: 'run_1', status: 'succeeded' });

  assert.equal(tab1.writes.length, 1, 'tab1 received terminal event');
  assert.equal(tab2.writes.length, 1, 'tab2 received terminal event');
  assert.equal(tab1.writes[0], tab2.writes[0], 'both received same data');
});

test('subscribe with a res whose write throws on initial ping removes it immediately', () => {
  const bus = createRunsEventBus();
  const brokenRes = {
    write() {
      throw new Error('connection already closed');
    },
    setHeader() {},
  };
  bus.subscribe('wf_1', brokenRes);
  assert.equal(bus.subscriberCount('wf_1'), 0, 'broken res removed on subscribe');
});

test('SSE event queue coalesces progress but preserves terminal events', async () => {
  const queue = createSseEventQueue({ maxPending: 2 });
  const iterator = queue[Symbol.asyncIterator]();

  queue.push({ id: '1', payload: { type: 'run_progress', runID: 'run_1', report: { step: 1 } } });
  queue.push({ id: '2', payload: { type: 'run_progress', runID: 'run_1', report: { step: 2 } } });
  queue.push({ id: '3', payload: { type: 'run_terminal', runID: 'run_1', status: 'succeeded' } });

  const first = await iterator.next();
  const second = await iterator.next();
  assert.equal(first.value.payload.type, 'run_progress');
  assert.equal(first.value.payload.report.step, 2);
  assert.equal(second.value.payload.type, 'run_terminal');

  queue.close();
  assert.equal((await iterator.next()).done, true);
});

test('SSE event queue closes on lifecycle overflow instead of growing unbounded', async () => {
  const queue = createSseEventQueue({ maxPending: 1 });
  const iterator = queue[Symbol.asyncIterator]();

  queue.push({ id: '1', payload: { type: 'run_terminal', runID: 'run_1' } });
  assert.equal(queue.push({ id: '2', payload: { type: 'run_terminal', runID: 'run_2' } }), false);
  assert.equal((await iterator.next()).done, true);
});
