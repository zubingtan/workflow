import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  compileStrictSchema,
  createStructuredOutputExtension,
  detectApiShape,
  StructuredOutputCapabilityError,
} from "../server/structured-output.mjs";

/**
 * #248: provider-native structured output injection.
 *
 * Covers:
 *   - compileStrictSchema: FlowGram IJsonSchema → strict provider schema,
 *     including legacy-document normalization (missing required), empty
 *     declarations → null, and malformed declarations → throw.
 *   - detectApiShape: openai-completions vs openai-responses vs unknown.
 *   - createStructuredOutputExtension: per-API-shape injection and
 *     fail-fast capability error on unknown shapes.
 *   - per-run isolation: separate extension instances never share schemas.
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

describe("detectApiShape", () => {
  test("openai-completions when payload has messages", () => {
    assert.equal(detectApiShape({ model: "m", messages: [] }), "openai-completions");
  });

  test("openai-responses when payload has input without messages", () => {
    assert.equal(detectApiShape({ model: "m", input: [] }), "openai-responses");
  });

  test("unknown otherwise", () => {
    assert.equal(detectApiShape({}), "unknown");
    assert.equal(detectApiShape(undefined), "unknown");
    assert.equal(detectApiShape(null), "unknown");
    assert.equal(detectApiShape("x"), "unknown");
  });
});

describe("createStructuredOutputExtension", () => {
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

  test("openai-completions payload gets response_format.json_schema with strict schema", () => {
    const result = invokeExtension(
      createStructuredOutputExtension({ compiled, provider: "p", model: "m", endpoint: "http://e" }),
      { model: "m", messages: [{ role: "user", content: "hi" }], stream: true },
    );
    assert.deepEqual(result.response_format, {
      type: "json_schema",
      json_schema: {
        name: compiled.name,
        strict: true,
        schema: compiled.schema,
      },
    });
    // Original payload is preserved (only the response_format key added).
    assert.deepEqual(result.messages, [{ role: "user", content: "hi" }]);
    assert.equal(result.stream, true);
  });

  test("openai-responses payload gets text.format.json_schema (never mixed with response_format)", () => {
    const result = invokeExtension(
      createStructuredOutputExtension({ compiled, provider: "p", model: "m", endpoint: "http://e" }),
      { model: "m", input: [{ role: "user", content: "hi" }] },
    );
    assert.equal("response_format" in result, false, "must not mix request shapes");
    assert.deepEqual(result.text, {
      format: {
        type: "json_schema",
        name: compiled.name,
        strict: true,
        schema: compiled.schema,
      },
    });
  });

  test("unknown payload shape throws StructuredOutputCapabilityError with provider/model/endpoint/api", () => {
    assert.throws(
      () =>
        invokeExtension(
          createStructuredOutputExtension({ compiled, provider: "custom", model: "m9", endpoint: "http://e" }),
          { instructions: "hi" },
        ),
      (err) => {
        assert.ok(err instanceof StructuredOutputCapabilityError);
        assert.equal(err.kind, "capability_error");
        assert.match(err.message, /provider=custom/);
        assert.match(err.message, /model=m9/);
        assert.match(err.message, /endpoint=http:\/\/e/);
        assert.match(err.message, /api=unknown/);
        return true;
      },
    );
  });

  test("two extensions with different schemas never leak across runs (#248 per-run isolation)", () => {
    const compiledA = compileStrictSchema({ type: "object", properties: { result: { type: "string" } } });
    const compiledB = compileStrictSchema({ type: "object", properties: { count: { type: "integer" } } });
    const resultA = invokeExtension(
      createStructuredOutputExtension({ compiled: compiledA }),
      { messages: [] },
    );
    const resultB = invokeExtension(
      createStructuredOutputExtension({ compiled: compiledB }),
      { messages: [] },
    );
    assert.deepEqual(resultA.response_format.json_schema.schema.properties, { result: { type: "string" } });
    assert.deepEqual(resultB.response_format.json_schema.schema.properties, { count: { type: "integer" } });
    assert.equal("count" in resultA.response_format.json_schema.schema.properties, false);
  });
});
