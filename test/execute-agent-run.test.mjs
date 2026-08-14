import assert from 'node:assert/strict';
import test from 'node:test';

import { createExecutionController } from '../src/agent-execution/execute-agent-run.mjs';

/**
 * Build a fake Response with a ReadableStream that emits the given SSE chunks.
 * Each chunk is a string; the stream closes after the last chunk.
 */
function sseResponse(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    body,
    json: async () => ({ error: `HTTP ${status}` }),
  };
}

/** Collect all events emitted by the controller until a terminal arrives. */
function collectEvents(controller, runInput, sendRequest) {
  const events = [];
  let resolveTerminal;
  const done = new Promise((r) => {
    resolveTerminal = r;
  });
  const ctrl = createExecutionController({
    sendRequest,
    onEvent: (ev) => {
      events.push(ev);
      if (ev.type === 'terminal') resolveTerminal();
    },
  });
  ctrl.run(runInput);
  return { events, done, controller: ctrl };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('controller: successful run emits phase + content_delta + terminal succeeded', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () =>
      sseResponse([
        'data: {"type":"content_delta","content":"hello"}\n\n',
        'data: {"type":"finish"}\n\n',
      ]),
  );
  await done;
  assert.deepEqual(events, [
    { type: 'phase', phase: 'streaming' },
    { type: 'content_delta', content: 'hello' },
    { type: 'terminal', phase: 'succeeded' },
  ]);
});

test('controller: tool_start + tool_end events pass through', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () =>
      sseResponse([
        'data: {"type":"tool_start","toolName":"read","args":{}}\n\n',
        'data: {"type":"tool_end","toolName":"read","result":"ok"}\n\n',
        'data: {"type":"finish"}\n\n',
      ]),
  );
  await done;
  assert.equal(events.length, 4);
  assert.equal(events[0].type, 'phase');
  assert.equal(events[1].type, 'tool_start');
  assert.equal(events[1].toolName, 'read');
  assert.equal(events[2].type, 'tool_end');
  assert.equal(events[2].toolName, 'read');
  assert.equal(events[3].type, 'terminal');
  assert.equal(events[3].phase, 'succeeded');
});

test('controller: error event → terminal failed with message', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () =>
      sseResponse([
        'data: {"type":"error","message":"upstream 500","kind":"provider_error"}\n\n',
      ]),
  );
  await done;
  assert.deepEqual(events, [
    { type: 'phase', phase: 'streaming' },
    { type: 'terminal', phase: 'failed', error: 'upstream 500' },
  ]);
});

test('controller: cancelled SSE event → terminal cancelled', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () => sseResponse(['data: {"type":"cancelled"}\n\n']),
  );
  await done;
  assert.deepEqual(events, [
    { type: 'phase', phase: 'streaming' },
    { type: 'terminal', phase: 'cancelled' },
  ]);
});

test('controller: stream ends without terminal event → default succeeded', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () =>
      sseResponse([
        'data: {"type":"content_delta","content":"partial"}\n\n',
      ]),
  );
  await done;
  assert.deepEqual(events, [
    { type: 'phase', phase: 'streaming' },
    { type: 'content_delta', content: 'partial' },
    { type: 'terminal', phase: 'succeeded' },
  ]);
});

test('controller: multiple content_delta events concatenate', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () =>
      sseResponse([
        'data: {"type":"content_delta","content":"a"}\n\n',
        'data: {"type":"content_delta","content":"b"}\n\n',
        'data: {"type":"content_delta","content":"c"}\n\n',
        'data: {"type":"finish"}\n\n',
      ]),
  );
  await done;
  const contentEvents = events.filter((e) => e.type === 'content_delta');
  assert.deepEqual(contentEvents, [
    { type: 'content_delta', content: 'a' },
    { type: 'content_delta', content: 'b' },
    { type: 'content_delta', content: 'c' },
  ]);
});

test('controller: flushes a terminal SSE frame without a trailing newline', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () => sseResponse(['data: {"type":"content_delta","content":"tail"}']),
  );
  await done;
  assert.deepEqual(events, [
    { type: 'phase', phase: 'streaming' },
    { type: 'content_delta', content: 'tail' },
    { type: 'terminal', phase: 'succeeded' },
  ]);
});

test('controller: HTTP non-OK response → terminal failed with status', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () => sseResponse([], { status: 500 }),
  );
  await done;
  assert.deepEqual(events, [
    { type: 'phase', phase: 'streaming' },
    { type: 'terminal', phase: 'failed', error: 'HTTP 500' },
  ]);
});

test('controller: HTTP non-OK with json error body → uses body.error', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () => ({
      ok: false,
      status: 400,
      body: null,
      json: async () => ({ error: 'missing env var: FOO_API_KEY' }),
    }),
  );
  await done;
  assert.deepEqual(events, [
    { type: 'phase', phase: 'streaming' },
    { type: 'terminal', phase: 'failed', error: 'missing env var: FOO_API_KEY' },
  ]);
});

test('controller: sendRequest throws → terminal failed', async () => {
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () => {
      throw new Error('network down');
    },
  );
  await done;
  assert.deepEqual(events, [
    { type: 'phase', phase: 'streaming' },
    { type: 'terminal', phase: 'failed', error: 'network down' },
  ]);
});

test('controller: cancel() mid-stream → terminal cancelled (local mark authoritative)', async () => {
  // A stream that emits one chunk then blocks forever (simulates a long run).
  const encoder = new TextEncoder();
  let emitted = false;
  const body = new ReadableStream({
    pull(controller) {
      if (!emitted) {
        emitted = true;
        controller.enqueue(encoder.encode('data: {"type":"content_delta","content":"partial"}\n\n'));
      } else {
        // Block — simulates a long-running stream the user cancels.
        return new Promise(() => {});
      }
    },
  });
  const events = [];
  let resolveFirst;
  const firstChunk = new Promise((r) => {
    resolveFirst = r;
  });
  let resolveTerminal;
  const done = new Promise((r) => {
    resolveTerminal = r;
  });
  const ctrl = createExecutionController({
    sendRequest: async () => ({ ok: true, status: 200, body }),
    onEvent: (ev) => {
      events.push(ev);
      if (ev.type === 'content_delta') resolveFirst();
      if (ev.type === 'terminal') resolveTerminal();
    },
  });
  ctrl.run({ agentId: 'a1', prompt: 'hi' });
  await firstChunk; // wait for the first chunk to land
  ctrl.cancel();
  await done;
  // Expect: phase streaming, content_delta partial, terminal cancelled.
  assert.equal(events[0].type, 'phase');
  assert.equal(events[1].type, 'content_delta');
  assert.equal(events[1].content, 'partial');
  const terminal = events.find((e) => e.type === 'terminal');
  assert.ok(terminal, 'expected a terminal event after cancel');
  assert.equal(terminal.phase, 'cancelled');
});

test('controller: re-run auto-supersedes previous run (no terminal from prev)', async () => {
  // First run: blocks forever on read.
  const body1 = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
  });
  // Second run: completes immediately.
  const encoder = new TextEncoder();
  let i = 0;
  const chunks = [
    'data: {"type":"content_delta","content":"second"}\n\n',
    'data: {"type":"finish"}\n\n',
  ];
  const body2 = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });

  const events = [];
  let resolveTerminal;
  const done = new Promise((r) => {
    resolveTerminal = r;
  });
  let callCount = 0;
  const ctrl = createExecutionController({
    sendRequest: async () => {
      callCount++;
      return callCount === 1
        ? { ok: true, status: 200, body: body1 }
        : { ok: true, status: 200, body: body2 };
    },
    onEvent: (ev) => {
      events.push(ev);
      if (ev.type === 'terminal') resolveTerminal();
    },
  });
  ctrl.run({ agentId: 'a1', prompt: 'first' });
  // Give the first run a tick to start reading.
  await wait(10);
  ctrl.run({ agentId: 'a1', prompt: 'second' });
  await done;

  // Only the second run should emit a terminal.
  const terminals = events.filter((e) => e.type === 'terminal');
  assert.equal(terminals.length, 1);
  assert.equal(terminals[0].phase, 'succeeded');
  // And the second run's content should be present.
  const contentEvents = events.filter((e) => e.type === 'content_delta');
  assert.equal(contentEvents.length, 1);
  assert.equal(contentEvents[0].content, 'second');
});

test('controller exposes only run and cancel controls', () => {
  const ctrl = createExecutionController({
    sendRequest: async () => sseResponse([]),
    onEvent: () => {},
  });
  assert.deepEqual(Object.keys(ctrl).sort(), ['cancel', 'run']);
});

test('controller: by-config input routes to sendRequest with config field', async () => {
  let received;
  const { events, done } = collectEvents(
    null,
    { config: { name: 'unsaved', model: 'm' }, prompt: 'hi' },
    async (input, signal) => {
      received = { input, signal };
      return sseResponse(['data: {"type":"finish"}\n\n']);
    },
  );
  await done;
  assert.equal(received.input.config.name, 'unsaved');
  assert.equal(received.input.prompt, 'hi');
  assert.ok(received.signal instanceof AbortSignal);
});

test('controller: by-id input routes to sendRequest with agentId field', async () => {
  let received;
  const { events, done } = collectEvents(
    null,
    { agentId: 'agent-42', prompt: 'hi' },
    async (input, signal) => {
      received = { input, signal };
      return sseResponse(['data: {"type":"finish"}\n\n']);
    },
  );
  await done;
  assert.equal(received.input.agentId, 'agent-42');
  assert.equal(received.input.prompt, 'hi');
});

test('controller: exactly one terminal per run (no double-emission)', async () => {
  // Stream emits finish, then an extra content_delta, then closes.
  // Controller must NOT emit a second terminal after the first.
  const { events, done } = collectEvents(
    null,
    { agentId: 'a1', prompt: 'hi' },
    async () =>
      sseResponse([
        'data: {"type":"finish"}\n\n',
        'data: {"type":"content_delta","content":"late"}\n\n',
      ]),
  );
  await done;
  await wait(10); // give any trailing events time to (not) fire
  const terminals = events.filter((e) => e.type === 'terminal');
  assert.equal(terminals.length, 1);
});
