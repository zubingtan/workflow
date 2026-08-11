import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  compileStrictSchema,
  createStructuredOutputPayloadExtension,
  createStructuredOutputTool,
  extractFinalAssistantMessage,
  StructuredOutputCapabilityError,
} from "../server/structured-output.mjs";

/**
 * #320: StructuredOutput-tool-route.
 *
 * Covers:
 *   - compileStrictSchema: FlowGram IJsonSchema → strict provider schema,
 *     including legacy-document normalization (missing required), empty
 *     declarations → null, and malformed declarations → throw.
 *   - createStructuredOutputTool: the customTool registered into pi — loose
 *     parameters ({type:"object"}) so pi's uncapped pre-validation never
 *     loops; execute validates strictly and either accepts (terminate) or
 *     feeds field-level errors back for the pi loop to retry, capped at
 *     maxRetries.
 *   - createStructuredOutputPayloadExtension: restores the STRICT compiled
 *     schema on the wire (both API shapes).
 *   - extractFinalAssistantMessage: last-assistant-message extraction incl.
 *     the final StructuredOutput toolCall block (parsed arguments).
 */

describe("compileStrictSchema", () => {
  test("compiles a single-field schema with all required + additionalProperties:false", () => {
    const compiled = compileStrictSchema({
      type: "object",
      properties: { result: { type: "string" } },
    });
    assert.deepEqual(compiled, {
      name: "workflow_agent_outputs",
      schema: {
        type: "object",
        required: ["result"],
        additionalProperties: false,
        properties: { result: { type: "string" } },
      },
    });
  });

  test("compiles all four primitive types and multiple fields", () => {
    const compiled = compileStrictSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
        ratio: { type: "number" },
        ok: { type: "boolean" },
      },
    });
    assert.deepEqual(compiled.schema.required, ["name", "count", "ratio", "ok"]);
    assert.deepEqual(compiled.schema.properties, {
      name: { type: "string" },
      count: { type: "integer" },
      ratio: { type: "number" },
      ok: { type: "boolean" },
    });
    assert.equal(compiled.schema.additionalProperties, false);
  });

  test("normalizes legacy documents that omit required (#246)", () => {
    const compiled = compileStrictSchema({
      type: "object",
      properties: { result: { type: "string" }, score: { type: "number" } },
    });
    // Legacy workflows declare properties without required — the property
    // list IS the contract; all fields become required at compile time.
    assert.deepEqual(compiled.schema.required, ["result", "score"]);
  });

  test("preserves field descriptions in the provider schema", () => {
    const compiled = compileStrictSchema({
      type: "object",
      properties: { result: { type: "string", description: "The final answer" } },
    });
    assert.deepEqual(compiled.schema.properties, {
      result: { type: "string", description: "The final answer" },
    });
  });

  test("returns null for undefined / null / empty declarations (no structured contract)", () => {
    assert.equal(compileStrictSchema(undefined), null);
    assert.equal(compileStrictSchema(null), null);
    assert.equal(compileStrictSchema({ type: "object", properties: {} }), null);
  });

  test("throws on non-object declaration", () => {
    assert.throws(() => compileStrictSchema("oops"), /must be an object/);
    assert.throws(() => compileStrictSchema({ type: "string" }), /type "object"/);
  });

  test("throws on invalid field names (mirrors the UI rules)", () => {
    // A hand-edited document can bypass the editor; the backend must reject
    // prototype keys, dots (break node-id.field refs), control chars, Chinese.
    // JSON.parse builds `__proto__` as an OWN property (a literal `{__proto__:}`
    // would hit the setter instead), matching how hand-edited docs arrive.
    assert.throws(
      () => compileStrictSchema(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')),
      /reserved name/,
    );
    assert.throws(
      () => compileStrictSchema({ type: "object", properties: { _executionDetail: { type: "string" } } }),
      /reserved name/,
    );
    assert.throws(
      () => compileStrictSchema({ type: "object", properties: { "user.name": { type: "string" } } }),
      /Dots/,
    );
    assert.throws(
      () => compileStrictSchema({ type: "object", properties: { "结果": { type: "string" } } }),
      /Chinese characters/,
    );
  });

  test("throws on non-primitive / nested field types", () => {
    assert.throws(
      () => compileStrictSchema({ type: "object", properties: { nested: { type: "object" } } }),
      /unsupported type "object"/,
    );
    assert.throws(
      () => compileStrictSchema({ type: "object", properties: { arr: { type: "array" } } }),
      /unsupported type "array"/,
    );
    assert.throws(
      () => compileStrictSchema({ type: "object", properties: { bad: "string" } }),
      /must be an object with a primitive type/,
    );
  });
});

describe("createStructuredOutputTool (#320)", () => {
  const compiled = compileStrictSchema({
    type: "object",
    properties: { result: { type: "string" }, n: { type: "integer" } },
  });

  /** Run one execute() against parsed arguments (pi passes parsed objects). */
  const run = (tool, args) => tool.execute("call_1", args, undefined, undefined, {});

  test("definition carries LOOSE parameters ({type:'object'}) — strict validation lives in execute", () => {
    const tool = createStructuredOutputTool({ compiled });
    assert.equal(tool.name, "StructuredOutput");
    assert.deepEqual(tool.parameters, { type: "object" });
    assert.match(tool.description, /exactly once/i);
    assert.ok(Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length > 0);
    assert.match(tool.promptGuidelines[0], /MUST call the StructuredOutput tool exactly once/i);
  });

  test("execute accepts valid arguments: terminate + projected outputs in details", async () => {
    const tool = createStructuredOutputTool({ compiled });
    const result = await run(tool, { result: "ok", n: 3 });
    assert.equal(result.terminate, true, "accepted toolCall ends the agent turn");
    assert.equal(result.details.ok, true);
    assert.deepEqual(result.details.outputs, { result: "ok", n: 3 });
  });

  test("execute rejects invalid arguments with field-level reasons, no terminate (model retries)", async () => {
    const tool = createStructuredOutputTool({ compiled });
    const result = await run(tool, { result: "ok", n: "3" });
    assert.equal(result.terminate, undefined, "a rejected call must NOT end the agent turn");
    assert.equal(result.details.ok, false);
    const text = result.content[0].text;
    assert.match(text, /field "n" must be integer/);
    assert.match(text, /call the tool again/i);
  });

  test("execute terminates after maxRetries with retry-cap error text", async () => {
    const tool = createStructuredOutputTool({ compiled, maxRetries: 3 });
    let last;
    for (let i = 0; i < 3; i++) {
      last = await run(tool, { result: "ok", n: "3" });
    }
    assert.equal(last.terminate, true, "retry cap forces termination");
    assert.match(last.content[0].text, /retry cap \(3\) exceeded/i);
  });

  test("attempt budget is per-tool-instance (per-run isolation)", async () => {
    const a = createStructuredOutputTool({ compiled, maxRetries: 2 });
    const b = createStructuredOutputTool({ compiled, maxRetries: 2 });
    await run(a, { result: "ok", n: "3" }); // a: attempt 1/2 — retryable
    const aLast = await run(a, { result: "ok", n: "3" }); // a: attempt 2/2 — cap
    assert.equal(aLast.terminate, true, "a exhausted its budget");
    const bFirst = await run(b, { result: "ok", n: "3" }); // b: attempt 1/2 — fresh
    assert.equal(bFirst.terminate, undefined, "b has its own budget");
  });
});

describe("createStructuredOutputPayloadExtension (#320)", () => {
  const compiled = compileStrictSchema({
    type: "object",
    properties: { result: { type: "string" }, n: { type: "integer" } },
  });

  /** Run a factory's before_provider_request handler against a payload. */
  function invokeExtension(factory, payload) {
    let handler;
    const api = { on: (event, fn) => { handler = fn; } };
    factory(api); // resource loader calls factory(api) directly
    return handler({ payload });
  }

  test("completions shape: StructuredOutput parameters replaced with the strict schema; other tools untouched", () => {
    const result = invokeExtension(
      createStructuredOutputPayloadExtension(compiled),
      {
        model: "m",
        tools: [
          { type: "function", function: { name: "read_file", parameters: { type: "object" } } },
          { type: "function", function: { name: "StructuredOutput", parameters: { type: "object" } } },
        ],
      },
    );
    const so = result.tools.find((t) => t.function.name === "StructuredOutput");
    assert.deepEqual(so.function.parameters, compiled.schema);
    const read = result.tools.find((t) => t.function.name === "read_file");
    assert.deepEqual(read.function.parameters, { type: "object" }, "other tools untouched");
  });

  test("responses shape: tool.parameters replaced (no function wrapper)", () => {
    const result = invokeExtension(
      createStructuredOutputPayloadExtension(compiled),
      {
        model: "m",
        tools: [{ type: "function", name: "StructuredOutput", parameters: { type: "object" } }],
      },
    );
    assert.deepEqual(result.tools[0].parameters, compiled.schema);
  });

  test("payload without the tool is returned unchanged (SSE runs carry no extension anyway)", () => {
    // undefined return = "don't replace" in the runner's before_provider_request
    // semantics — the original payload goes out untouched.
    const payload = { model: "m", tools: [{ type: "function", function: { name: "read_file" } }] };
    const result = invokeExtension(createStructuredOutputPayloadExtension(compiled), payload);
    assert.equal(result, undefined, "no rewrite for payloads without the tool");
  });

  test("two extensions with different schemas never leak across runs (#248 per-run isolation)", () => {
    const compiledA = compileStrictSchema({ type: "object", properties: { result: { type: "string" } } });
    const compiledB = compileStrictSchema({ type: "object", properties: { count: { type: "integer" } } });
    const payload = {
      tools: [{ type: "function", function: { name: "StructuredOutput", parameters: { type: "object" } } }],
    };
    const resultA = invokeExtension(createStructuredOutputPayloadExtension(compiledA), payload);
    const resultB = invokeExtension(createStructuredOutputPayloadExtension(compiledB), payload);
    assert.deepEqual(resultA.tools[0].function.parameters.properties, { result: { type: "string" } });
    assert.deepEqual(resultB.tools[0].function.parameters.properties, { count: { type: "integer" } });
    assert.equal("count" in resultA.tools[0].function.parameters.properties, false);
  });
});

describe("extractFinalAssistantMessage toolCall extraction (#320)", () => {
  const toolCall = (name, args) => ({ type: "toolCall", id: "call_1", name, arguments: args });

  test("pure toolCall message (content='') yields the LAST toolCall with parsed arguments", () => {
    const session = {
      messages: [
        {
          role: "assistant",
          content: [toolCall("read_file", { path: "/a" }), toolCall("StructuredOutput", { result: "ok", n: 3 })],
          stopReason: "toolUse",
        },
      ],
    };
    const msg = extractFinalAssistantMessage(session);
    assert.equal(msg.text, "");
    assert.deepEqual(msg.toolCall, { name: "StructuredOutput", arguments: { result: "ok", n: 3 } });
  });

  test("mixed text + toolCall keeps text and the LAST toolCall", () => {
    const session = {
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "thinking" }, toolCall("StructuredOutput", { result: "ok", n: 1 })],
          stopReason: "stop",
        },
      ],
    };
    const msg = extractFinalAssistantMessage(session);
    assert.equal(msg.text, "thinking");
    assert.deepEqual(msg.toolCall, { name: "StructuredOutput", arguments: { result: "ok", n: 1 } });
  });

  test("a non-StructuredOutput toolCall never shadows the StructuredOutput candidate", () => {
    // Mixed batch: read_file BEFORE and AFTER the StructuredOutput call — the
    // extraction must keep the StructuredOutput call, not the last block.
    const session = {
      messages: [
        {
          role: "assistant",
          content: [
            toolCall("read_file", { path: "/a" }),
            toolCall("StructuredOutput", { result: "ok", n: 1 }),
            toolCall("grep", { query: "x" }),
          ],
          stopReason: "toolUse",
        },
      ],
    };
    const msg = extractFinalAssistantMessage(session);
    assert.deepEqual(msg.toolCall, { name: "StructuredOutput", arguments: { result: "ok", n: 1 } });
  });

  test("last assistant message wins; messages without toolCall yield null toolCall", () => {
    const session = {
      messages: [
        { role: "assistant", content: [toolCall("StructuredOutput", { result: "old" })], stopReason: "toolUse" },
        { role: "toolResult", toolCallId: "call_1", toolName: "StructuredOutput", content: [] },
        { role: "assistant", content: [{ type: "text", text: "final" }], stopReason: "stop" },
      ],
    };
    const msg = extractFinalAssistantMessage(session);
    assert.equal(msg.text, "final");
    assert.equal(msg.toolCall, null);
  });
});
