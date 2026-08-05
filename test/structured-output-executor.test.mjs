import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createAgentExecutor, AgentExecutionError } from "../server/runtime-adapter.mjs";

/**
 * #248: AgentExecutor wiring for the structured output contract.
 *
 * Verifies:
 *   - the declared outputs schema (FlowGram puts data.outputs into
 *     node.declare.outputs at runtime) is compiled per run and handed to
 *     createSession as the 4th argument (request-scoped, never persisted on
 *     the agent).
 *   - a malformed declaration fails BEFORE any provider request with
 *     kind="structured_output_error".
 *   - a capability terminal from the execution layer keeps its
 *     kind="capability_error" when projected to AgentExecutionError.
 *   - runs WITHOUT a declared schema pass structured=null (legacy behavior).
 */

function makeAgent() {
  return {
    id: "a1",
    config: JSON.stringify({
      provider: { base_url: "http://p/v1", api_key: "k", model: "m1" },
    }),
  };
}

function makeDb() {
  return { prepare: () => ({ get: () => makeAgent() }) };
}

/** Captures createSession args; yields a succeeded terminal. */
function makeFakeRunAgentExecution(captured) {
  return async function* fakeRunAgentExecution({ agentConfig, prompt, createSession }) {
    captured.createSession = createSession;
    captured.agentConfig = agentConfig;
    captured.prompt = prompt;
    const session = await createSession(agentConfig, "/tmp/agent-dir");
    yield { type: "terminal", phase: "succeeded", partialText: "ok", toolEvents: [] };
    void session;
  };
}

describe("AgentExecutor structured output wiring", () => {
  test("declared outputs schema is compiled and passed as 4th createSession arg", async () => {
    const captured = {};
    const executor = createAgentExecutor({
      db: makeDb(),
      agentDir: "/tmp/agent-dir",
      createSession: async (agent, dir, mem0, structured) => {
        captured.structured = structured;
        return { dispose() {} };
      },
      runAgentExecution: makeFakeRunAgentExecution(captured),
    });

    // FlowGram moves data.outputs into node.declare.outputs at runtime.
    await executor.execute({
      inputs: { agentId: "a1", prompt: "p" },
      signal: new AbortController().signal,
      node: {
        data: { title: "Agent_Main" },
        declare: {
          outputs: {
            type: "object",
            properties: { result: { type: "string" }, n: { type: "integer" } },
          },
        },
      },
    });

    assert.ok(captured.structured, "structured contract must be passed through");
    assert.deepEqual(captured.structured.schema.properties, {
      result: { type: "string" },
      n: { type: "integer" },
    });
    assert.deepEqual(captured.structured.schema.required, ["result", "n"]);
  });

  test("falls back to data.outputs when declare is absent (defensive)", async () => {
    const captured = {};
    const executor = createAgentExecutor({
      db: makeDb(),
      agentDir: "/tmp/agent-dir",
      createSession: async (agent, dir, mem0, structured) => {
        captured.structured = structured;
        return { dispose() {} };
      },
      runAgentExecution: makeFakeRunAgentExecution(captured),
    });

    await executor.execute({
      inputs: { agentId: "a1", prompt: "p" },
      signal: new AbortController().signal,
      node: {
        data: {
          outputs: { type: "object", properties: { result: { type: "string" } } },
        },
      },
    });
    assert.ok(captured.structured);
    assert.deepEqual(captured.structured.schema.properties, { result: { type: "string" } });
  });

  test("node without declared outputs passes structured=null (legacy path unchanged)", async () => {
    const captured = {};
    const executor = createAgentExecutor({
      db: makeDb(),
      agentDir: "/tmp/agent-dir",
      createSession: async (agent, dir, mem0, structured) => {
        captured.structured = structured;
        return { dispose() {} };
      },
      runAgentExecution: makeFakeRunAgentExecution(captured),
    });

    await executor.execute({
      inputs: { agentId: "a1", prompt: "p" },
      signal: new AbortController().signal,
      node: { data: {} },
    });
    assert.equal(captured.structured, null);
  });

  test("malformed declaration fails before any request with structured_output_error", async () => {
    let sessionCreated = false;
    const executor = createAgentExecutor({
      db: makeDb(),
      agentDir: "/tmp/agent-dir",
      createSession: async () => {
        sessionCreated = true;
        return { dispose() {} };
      },
      runAgentExecution: makeFakeRunAgentExecution({}),
    });

    await assert.rejects(
      () =>
        executor.execute({
          inputs: { agentId: "a1", prompt: "p" },
          signal: new AbortController().signal,
          node: {
            data: {},
            declare: {
              outputs: { type: "object", properties: { bad: { type: "object" } } },
            },
          },
        }),
      (err) => {
        assert.ok(err instanceof AgentExecutionError);
        assert.equal(err.kind, "structured_output_error");
        assert.match(err.message, /invalid structured output schema/);
        return true;
      },
    );
    assert.equal(sessionCreated, false, "no session may be created for a malformed schema");
  });

  test("capability terminal keeps kind=capability_error through the executor projection", async () => {
    const executor = createAgentExecutor({
      db: makeDb(),
      agentDir: "/tmp/agent-dir",
      createSession: async () => ({ dispose() {} }),
      runAgentExecution: async function* () {
        yield {
          type: "terminal",
          phase: "failed",
          partialText: "",
          toolEvents: [],
          error: {
            kind: "capability_error",
            message: "Structured output not supported: provider=custom model=m9 endpoint=http://e api=unknown",
          },
        };
      },
    });

    await assert.rejects(
      () =>
        executor.execute({
          inputs: { agentId: "a1", prompt: "p" },
          signal: new AbortController().signal,
          node: { data: { outputs: { type: "object", properties: { result: { type: "string" } } } } },
        }),
      (err) => {
        assert.ok(err instanceof AgentExecutionError);
        assert.equal(err.kind, "capability_error");
        assert.match(err.message, /provider=custom/);
        return true;
      },
    );
  });
});
