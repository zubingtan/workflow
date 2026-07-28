import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunsEventBus } from "./runs-events.mjs";

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

test("subscribe sets SSE headers and writes initial :ping", () => {
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe("wf_1", res);
  assert.equal(res.headers["Content-Type"], "text/event-stream");
  assert.equal(res.headers["Cache-Control"], "no-cache");
  assert.equal(res.headers["Connection"], "keep-alive");
  assert.equal(res.writes[0], ":ping\n\n");
});

test("broadcast writes SSE-formatted data to all subscribers of that workflow", () => {
  const bus = createRunsEventBus();
  const res1 = makeFakeRes();
  const res2 = makeFakeRes();
  bus.subscribe("wf_1", res1);
  bus.subscribe("wf_1", res2);
  // Clear initial ping writes.
  res1.writes.length = 0;
  res2.writes.length = 0;

  bus.broadcast("wf_1", { type: "run_status", runID: "run_1", status: "queued" });

  assert.equal(res1.writes.length, 1);
  assert.equal(res2.writes.length, 1);
  assert.equal(
    res1.writes[0],
    `data: ${JSON.stringify({ type: "run_status", runID: "run_1", status: "queued" })}\n\n`
  );
  assert.equal(res1.writes[0], res2.writes[0]);
});

test("broadcast to a workflow does NOT reach subscribers of a different workflow", () => {
  const bus = createRunsEventBus();
  const res1 = makeFakeRes();
  const res2 = makeFakeRes();
  bus.subscribe("wf_1", res1);
  bus.subscribe("wf_2", res2);
  res1.writes.length = 0;
  res2.writes.length = 0;

  bus.broadcast("wf_1", { type: "run_status", runID: "run_1", status: "queued" });

  assert.equal(res1.writes.length, 1, "wf_1 subscriber received event");
  assert.equal(res2.writes.length, 0, "wf_2 subscriber did NOT receive event");
});

test("broadcast removes dead subscribers (EPIPE) without crashing", () => {
  const bus = createRunsEventBus();
  const aliveRes = makeFakeRes();
  const deadRes = {
    write() { throw new Error("write EPIPE"); },
    setHeader() {},
  };
  bus.subscribe("wf_1", aliveRes);
  bus.subscribe("wf_1", deadRes);
  aliveRes.writes.length = 0;

  bus.broadcast("wf_1", { type: "run_status", runID: "run_1", status: "running" });

  assert.equal(aliveRes.writes.length, 1, "alive subscriber still received event");
  assert.equal(bus.subscriberCount("wf_1"), 1, "dead subscriber removed from Set");
});

test("unsubscribe removes subscriber and deletes empty Set", () => {
  const bus = createRunsEventBus();
  const res = makeFakeRes();
  bus.subscribe("wf_1", res);
  assert.equal(bus.subscriberCount("wf_1"), 1);

  bus.unsubscribe("wf_1", res);
  assert.equal(bus.subscriberCount("wf_1"), 0, "unsubscribed");

  // Broadcasting to a workflow with no subscribers is a no-op.
  bus.broadcast("wf_1", { type: "run_status", runID: "run_1", status: "queued" });
});

test("broadcastAll sends to subscribers of EVERY workflow", () => {
  const bus = createRunsEventBus();
  const res1 = makeFakeRes();
  const res2 = makeFakeRes();
  const res3 = makeFakeRes();
  bus.subscribe("wf_1", res1);
  bus.subscribe("wf_2", res2);
  bus.subscribe("wf_3", res3);
  res1.writes.length = 0;
  res2.writes.length = 0;
  res3.writes.length = 0;

  bus.broadcastAll({ type: "workflow_deleted", workflowId: "wf_1" });

  assert.equal(res1.writes.length, 1, "wf_1 subscriber received broadcastAll");
  assert.equal(res2.writes.length, 1, "wf_2 subscriber received broadcastAll");
  assert.equal(res3.writes.length, 1, "wf_3 subscriber received broadcastAll");
  for (const res of [res1, res2, res3]) {
    assert.equal(
      res.writes[0],
      `data: ${JSON.stringify({ type: "workflow_deleted", workflowId: "wf_1" })}\n\n`
    );
  }
});

test("multi-tab: two subscribers on same workflow both receive broadcasts", () => {
  const bus = createRunsEventBus();
  const tab1 = makeFakeRes();
  const tab2 = makeFakeRes();
  bus.subscribe("wf_1", tab1);
  bus.subscribe("wf_1", tab2);
  tab1.writes.length = 0;
  tab2.writes.length = 0;

  bus.broadcast("wf_1", { type: "run_terminal", runID: "run_1", status: "succeeded" });

  assert.equal(tab1.writes.length, 1, "tab1 received terminal event");
  assert.equal(tab2.writes.length, 1, "tab2 received terminal event");
  assert.equal(tab1.writes[0], tab2.writes[0], "both received same data");
});

test("subscribe with a res whose write throws on initial ping removes it immediately", () => {
  const bus = createRunsEventBus();
  const brokenRes = {
    write() { throw new Error("connection already closed"); },
    setHeader() {},
  };
  bus.subscribe("wf_1", brokenRes);
  assert.equal(bus.subscriberCount("wf_1"), 0, "broken res removed on subscribe");
});
