import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkflowRunEventHub } from '../src/workflow-run-event-hub.mjs';

function createFakeEventSources() {
  const sources = [];
  return {
    sources,
    create(url) {
      const source = {
        url,
        onmessage: null,
        onerror: null,
        closed: false,
        close() {
          source.closed = true;
        },
        emit(payload, lastEventId) {
          source.onmessage?.({ data: JSON.stringify(payload), lastEventId });
        },
        error() {
          source.onerror?.({ type: 'error', target: source });
        },
      };
      sources.push(source);
      return source;
    },
  };
}

function progress(runID, sequence, snapshotLength) {
  return {
    type: 'run_progress',
    runID,
    sequence,
    report: {
      reports: {
        nodeA: {
          status: 'processing',
          snapshots: Array.from({ length: snapshotLength }, () => ({})),
        },
      },
    },
  };
}

test('shares one EventSource and closes it after the last unsubscribe', () => {
  const fake = createFakeEventSources();
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const first = [];
  const second = [];

  const unsubscribeFirst = hub.subscribe('workflow-1', { onEvent: (event) => first.push(event) });
  const unsubscribeSecond = hub.subscribe('workflow-1', {
    runID: 'run-2',
    onEvent: (event) => second.push(event),
  });

  assert.equal(fake.sources.length, 1);
  assert.equal(hub.connectionCount('workflow-1'), 1);
  assert.equal(hub.subscriberCount('workflow-1'), 2);

  fake.sources[0].emit({ type: 'run_status', runID: 'run-1', status: 'running' });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0);

  unsubscribeFirst();
  assert.equal(fake.sources[0].closed, true);
  assert.equal(fake.sources.length, 2);
  unsubscribeSecond();
  assert.equal(fake.sources[1].closed, true);
  assert.equal(hub.connectionCount('workflow-1'), 0);
});

test('shares one page EventSource across workflows and encodes server filters', () => {
  const fake = createFakeEventSources();
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const workflowEvents = [];
  const runEvents = [];

  const unsubscribe = hub.subscribeMany([
    {
      workflowId: 'workflow-1',
      subscription: {
        runID: 'run-1',
        types: ['run_status'],
        onEvent: (event) => workflowEvents.push(event),
      },
    },
    {
      workflowId: 'workflow-2',
      subscription: {
        runID: 'run-2',
        types: ['run_progress'],
        onEvent: (event) => runEvents.push(event),
      },
    },
  ]);

  assert.equal(fake.sources.length, 1);
  const url = new URL(fake.sources[0].url, 'http://localhost');
  assert.deepEqual(url.searchParams.getAll('workflowId'), ['workflow-1', 'workflow-2']);
  assert.deepEqual(url.searchParams.getAll('runID'), ['run-1', 'run-2']);
  assert.deepEqual(url.searchParams.getAll('type'), ['run_progress', 'run_status']);

  fake.sources[0].emit({
    type: 'run_status',
    workflowId: 'workflow-1',
    runID: 'run-1',
    status: 'running',
  });
  fake.sources[0].emit({
    type: 'run_progress',
    workflowId: 'workflow-2',
    runID: 'run-2',
    report: {},
  });

  assert.equal(workflowEvents.length, 1);
  assert.equal(runEvents.length, 1);
  assert.equal(hub.connectionCount(), 1);
  assert.equal(hub.connectionCount('workflow-1'), 1);
  assert.equal(hub.connectionCount('workflow-3'), 0);

  unsubscribe();
  assert.equal(fake.sources[0].closed, true);
  assert.equal(hub.connectionCount(), 0);
});

test('reconnect errors are fanned out while the native source remains owned by the hub', () => {
  const fake = createFakeEventSources();
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const errors = [];
  const events = [];
  const unsubscribe = hub.subscribe('workflow-1', {
    onEvent: (event) => events.push(event),
    onError: (error) => errors.push(error.type),
  });

  fake.sources[0].error();
  fake.sources[0].emit({ type: 'init', activeRunIDs: ['run-1'], activeRuns: [] });

  assert.deepEqual(errors, ['error']);
  assert.equal(events[0].type, 'init');
  assert.equal(fake.sources[0].closed, false);
  unsubscribe();
});

test('reconnect errors trigger one REST snapshot reconciliation', async () => {
  const fake = createFakeEventSources();
  const snapshots = [];
  const events = [];
  const hub = new WorkflowRunEventHub({
    createEventSource: fake.create.bind(fake),
    fetchSnapshot: async (workflowId) => {
      snapshots.push(workflowId);
      return [{ id: 'run-1', status: 'succeeded' }];
    },
  });
  const unsubscribe = hub.subscribe('workflow-1', { onEvent: (event) => events.push(event) });

  fake.sources[0].error();
  fake.sources[0].error();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(snapshots, ['workflow-1']);
  assert.deepEqual(events, [
    {
      type: 'snapshot',
      workflowId: 'workflow-1',
      runs: [{ id: 'run-1', status: 'succeeded' }],
    },
  ]);
  unsubscribe();
});

test('initial connection reconciles a REST snapshot', async () => {
  const fake = createFakeEventSources();
  const snapshots = [];
  const events = [];
  const hub = new WorkflowRunEventHub({
    createEventSource: fake.create.bind(fake),
    fetchSnapshot: async (workflowId) => {
      snapshots.push(workflowId);
      return [{ id: 'run-1', status: 'running' }];
    },
  });
  const unsubscribe = hub.subscribe('workflow-1', { onEvent: (event) => events.push(event) });

  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(snapshots, ['workflow-1']);
  assert.equal(events[0].type, 'snapshot');
  unsubscribe();
});

test('a stale snapshot cannot regress a newer running status', async () => {
  const fake = createFakeEventSources();
  let resolveSnapshot;
  const events = [];
  const hub = new WorkflowRunEventHub({
    createEventSource: fake.create.bind(fake),
    fetchSnapshot: () =>
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
  });
  const unsubscribe = hub.subscribe('workflow-1', { onEvent: (event) => events.push(event) });

  fake.sources[0].emit({ type: 'run_status', runID: 'run-1', status: 'running' });
  resolveSnapshot([{ id: 'run-1', status: 'queued' }]);
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = events.find((event) => event.type === 'snapshot');
  assert.equal(snapshot.runs[0].status, 'running');
  unsubscribe();
});

test('a stale init frame cannot regress a newer running status', () => {
  const fake = createFakeEventSources();
  const events = [];
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const unsubscribe = hub.subscribe('workflow-1', { onEvent: (event) => events.push(event) });

  fake.sources[0].emit({ type: 'run_status', runID: 'run-1', status: 'running' });
  fake.sources[0].emit({
    type: 'init',
    workflowId: 'workflow-1',
    activeRunIDs: ['run-1'],
    activeRuns: [{ runID: 'run-1', status: 'queued', report: null }],
  });

  const init = events.find((event) => event.type === 'init');
  assert.equal(init.activeRuns[0].status, 'running');
  unsubscribe();
});

test('terminal status from a REST snapshot blocks late status and progress', async () => {
  const fake = createFakeEventSources();
  const events = [];
  const hub = new WorkflowRunEventHub({
    createEventSource: fake.create.bind(fake),
    fetchSnapshot: async () => [{ id: 'run-1', status: 'succeeded' }],
  });
  const unsubscribe = hub.subscribe('workflow-1', {
    runID: 'run-1',
    onEvent: (event) => events.push(event),
  });

  fake.sources[0].error();
  await new Promise((resolve) => setImmediate(resolve));
  fake.sources[0].emit({ type: 'run_status', runID: 'run-1', status: 'running' });
  fake.sources[0].emit(progress('run-1', undefined, 2));

  assert.deepEqual(
    events.map((event) => event.type),
    ['snapshot']
  );
  unsubscribe();
});

test('a snapshot cannot replace a terminal event with an active row', async () => {
  const fake = createFakeEventSources();
  const events = [];
  const hub = new WorkflowRunEventHub({
    createEventSource: fake.create.bind(fake),
    fetchSnapshot: async () => [{ id: 'run-1', status: 'running' }],
  });
  const unsubscribe = hub.subscribe('workflow-1', {
    runID: 'run-1',
    onEvent: (event) => events.push(event),
  });

  fake.sources[0].emit({ type: 'run_terminal', runID: 'run-1', status: 'succeeded' });
  fake.sources[0].error();
  await new Promise((resolve) => setImmediate(resolve));

  const snapshot = events.find((event) => event.type === 'snapshot');
  assert.equal(snapshot.runs[0].status, 'succeeded');
  unsubscribe();
});

test('init snapshots are delivered after reconnect and stale progress is dropped', () => {
  const fake = createFakeEventSources();
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const events = [];
  const unsubscribe = hub.subscribe('workflow-1', {
    runID: 'run-1',
    onEvent: (event) => events.push(event),
  });

  fake.sources[0].emit({ type: 'init', activeRunIDs: ['run-1'], activeRuns: [] });
  fake.sources[0].emit(progress('run-1', 2, 2));
  fake.sources[0].emit(progress('run-1', 1, 1));

  assert.deepEqual(
    events.map((event) => event.type),
    ['init', 'run_progress']
  );
  unsubscribe();
});

test('progress without a sequence still rejects a regressing snapshot', () => {
  const fake = createFakeEventSources();
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const events = [];
  const unsubscribe = hub.subscribe('workflow-1', {
    onEvent: (event) => events.push(event),
  });

  fake.sources[0].emit({ ...progress('run-1', undefined, 3), sequence: undefined });
  fake.sources[0].emit({ ...progress('run-1', undefined, 2), sequence: undefined });

  assert.equal(events.length, 1);
  unsubscribe();
});

test('terminal events prevent late status and progress from reopening a run', () => {
  const fake = createFakeEventSources();
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const events = [];
  const unsubscribe = hub.subscribe('workflow-1', {
    runID: 'run-1',
    onEvent: (event) => events.push(event),
  });

  fake.sources[0].emit({ type: 'run_terminal', runID: 'run-1', status: 'succeeded' });
  fake.sources[0].emit({ type: 'run_status', runID: 'run-1', status: 'running' });
  fake.sources[0].emit(progress('run-1', undefined, 4));

  assert.deepEqual(
    events.map((event) => event.type),
    ['run_terminal']
  );
  unsubscribe();
});

test('event type filters do not affect other subscribers on the same connection', () => {
  const fake = createFakeEventSources();
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const progressEvents = [];
  const allEvents = [];
  const unsubscribeProgress = hub.subscribe('workflow-1', {
    types: ['run_progress'],
    onEvent: (event) => progressEvents.push(event),
  });
  const unsubscribeAll = hub.subscribe('workflow-1', { onEvent: (event) => allEvents.push(event) });
  const source = fake.sources.at(-1);

  source.emit({ type: 'run_status', runID: 'run-1', status: 'running' });
  source.emit(progress('run-1', 1, 1));

  assert.deepEqual(
    progressEvents.map((event) => event.type),
    ['run_progress']
  );
  assert.deepEqual(
    allEvents.map((event) => event.type),
    ['run_status', 'run_progress']
  );
  unsubscribeProgress();
  unsubscribeAll();
});

test('workflow deletion is delivered once and closes the shared source', () => {
  const fake = createFakeEventSources();
  const hub = new WorkflowRunEventHub({ createEventSource: fake.create.bind(fake) });
  const events = [];
  hub.subscribe('workflow-1', { onEvent: (event) => events.push(event) });

  fake.sources[0].emit({ type: 'workflow_deleted', workflowId: 'workflow-1' });

  assert.deepEqual(
    events.map((event) => event.type),
    ['workflow_deleted']
  );
  assert.equal(fake.sources[0].closed, true);
  assert.equal(hub.connectionCount('workflow-1'), 0);
});
