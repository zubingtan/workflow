import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSseStream } from '../src/agent-execution/parse-sse-stream.mjs';

/**
 * Build a fake ReadableStream that emits the given chunks, then closes.
 * Each chunk is a string (encoded to Uint8Array).
 */
function fakeStream(chunks) {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

async function collect(reader, onEvent) {
  await parseSseStream(reader, onEvent);
}

test('parseSseStream: single content_delta in one chunk', async () => {
  const events = [];
  const reader = fakeStream(['data: {"type":"content_delta","content":"hi"}\n\n']).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [{ type: 'content_delta', content: 'hi' }]);
});

test('parseSseStream: content split across chunks', async () => {
  const events = [];
  // "data: {\"type\":\"co" + "ntent_delta\",..." — line fragmented
  const reader = fakeStream([
    'data: {"type":"con',
    'tent_delta","content":"hello"}\n\n',
  ]).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [{ type: 'content_delta', content: 'hello' }]);
});

test('parseSseStream: multiple events in one chunk', async () => {
  const events = [];
  const reader = fakeStream([
    'data: {"type":"content_delta","content":"a"}\n\ndata: {"type":"content_delta","content":"b"}\n\n',
  ]).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [
    { type: 'content_delta', content: 'a' },
    { type: 'content_delta', content: 'b' },
  ]);
});

test('parseSseStream: tool_start + tool_end + finish sequence', async () => {
  const events = [];
  const reader = fakeStream([
    'data: {"type":"tool_start","toolName":"read","args":{}}\n\n',
    'data: {"type":"tool_end","toolName":"read","result":"ok"}\n\n',
    'data: {"type":"finish"}\n\n',
  ]).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'tool_start');
  assert.equal(events[1].type, 'tool_end');
  assert.equal(events[2].type, 'finish');
});

test('parseSseStream: error event carries message + kind', async () => {
  const events = [];
  const reader = fakeStream([
    'data: {"type":"error","message":"upstream 500","kind":"provider_error"}\n\n',
  ]).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [
    { type: 'error', message: 'upstream 500', kind: 'provider_error' },
  ]);
});

test('parseSseStream: cancelled event (additive server-side cancel signal)', async () => {
  const events = [];
  const reader = fakeStream(['data: {"type":"cancelled"}\n\n']).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [{ type: 'cancelled' }]);
});

test('parseSseStream: blank/non-data lines ignored', async () => {
  const events = [];
  const reader = fakeStream([
    'event: message\n',
    ': comment\n',
    'data: {"type":"content_delta","content":"x"}\n\n',
  ]).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [{ type: 'content_delta', content: 'x' }]);
});

test('parseSseStream: malformed JSON skipped without throwing', async () => {
  const events = [];
  const reader = fakeStream([
    'data: {not json\n\n',
    'data: {"type":"content_delta","content":"y"}\n\n',
  ]).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [{ type: 'content_delta', content: 'y' }]);
});

test('parseSseStream: empty data payload ignored', async () => {
  const events = [];
  const reader = fakeStream([
    'data: \n\n',
    'data: {"type":"content_delta","content":"z"}\n\n',
  ]).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [{ type: 'content_delta', content: 'z' }]);
});

test('parseSseStream: trailing partial line buffered across reads', async () => {
  // First read ends mid-line (no \n\n terminator), second read completes it.
  // The two chunks together form the JSON `{"type":"content_delta","content":"partial"}`
  // — i.e. the split happens inside the content string value.
  const events = [];
  const reader = fakeStream([
    'data: {"type":"content_delta","content":"parti',
    'al"}\n\n',
  ]).getReader();
  await collect(reader, (ev) => events.push(ev));
  assert.deepEqual(events, [{ type: 'content_delta', content: 'partial' }]);
});
