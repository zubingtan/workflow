import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  fieldsToSchema,
  hasErrors,
  schemaToFields,
  validateFields,
} from '../src/nodes/llm/schema-state.mjs';

/**
 * #247: Structured Output Schema editor state rules.
 *
 * Covers: IJsonSchema round-trip, empty key, duplicate key, Chinese key,
 * dots, control characters, and the empty-declaration guard. The last-field
 * deletion guard lives in the editor component (readonly UI), but its data
 * rule — an empty field list must never emit a persisted schema — is pinned
 * here via fieldsToSchema → null.
 */

const field = (id, name, type = 'string') => ({ id, name, type });

describe('schemaToFields (IJsonSchema → field list)', () => {
  test('decodes flat object properties preserving names and types', () => {
    const fields = schemaToFields({
      type: 'object',
      properties: {
        result: { type: 'string' },
        count: { type: 'integer' },
        ratio: { type: 'number' },
        ok: { type: 'boolean' },
      },
    });
    assert.deepEqual(
      fields.map(({ name, type }) => ({ name, type })),
      [
        { name: 'result', type: 'string' },
        { name: 'count', type: 'integer' },
        { name: 'ratio', type: 'number' },
        { name: 'ok', type: 'boolean' },
      ],
    );
  });

  test('preserves existing field descriptions', () => {
    const schema = {
      type: 'object',
      properties: {
        result: { type: 'string', description: 'The final answer' },
      },
    };
    const fields = schemaToFields(schema);
    assert.equal(fields[0].description, 'The final answer');
    assert.deepEqual(JSON.parse(JSON.stringify(fieldsToSchema(fields))), schema);
  });

  test('unknown field types fall back to string (defensive decode)', () => {
    const fields = schemaToFields({
      type: 'object',
      properties: { weird: { type: 'object' } },
    });
    assert.equal(fields[0].type, 'string');
  });

  test('missing / non-object / empty properties → empty list (no phantom result)', () => {
    assert.deepEqual(schemaToFields(undefined), []);
    assert.deepEqual(schemaToFields(null), []);
    assert.deepEqual(schemaToFields({ type: 'object', properties: {} }), []);
    assert.deepEqual(schemaToFields({ type: 'array' }), []);
  });
});

describe('fieldsToSchema (field list → IJsonSchema)', () => {
  test('round-trips to the FlowGram IJsonSchema shape (no extra keys)', () => {
    const schema = fieldsToSchema([
      field('a', 'result', 'string'),
      field('b', 'count', 'integer'),
    ]);
    // properties is a null-prototype bag (defense against `__proto__` field
    // names); normalize through JSON — the same path persistence takes.
    assert.deepEqual(JSON.parse(JSON.stringify(schema)), {
      type: 'object',
      properties: {
        result: { type: 'string' },
        count: { type: 'integer' },
      },
    });
  });

  test('empty field list → null (never persists an empty contract)', () => {
    assert.equal(fieldsToSchema([]), null);
  });
});

describe('prototype-chain field names', () => {
  test('reserved/prototype keys are rejected by validateFields', () => {
    for (const name of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      '_executionDetail',
    ]) {
      const errs = validateFields([field('a', name)]);
      assert.match(errs.a, /reserved name/, `${name} must be rejected`);
    }
  });
});

describe('validateFields (#242 field-name rules)', () => {
  test('empty key is rejected', () => {
    const errs = validateFields([field('a', '   ')]);
    assert.match(errs.a, /cannot be empty/);
  });

  test('leading/trailing spaces are rejected (no silent trim vs persisted name)', () => {
    const errs = validateFields([field('a', ' result ')]);
    assert.match(errs.a, /Leading or trailing spaces/);
    // All-space keys are still an empty-name error, not a spaces error.
    assert.match(validateFields([field('b', ' ')]) .b, /cannot be empty/);
  });

  test('duplicate keys are rejected on the later occurrence', () => {
    const errs = validateFields([field('a', 'name'), field('b', 'name')]);
    assert.equal(errs.a, undefined, 'first occurrence stays valid');
    assert.match(errs.b, /Duplicate field name "name"/);
  });

  test('Chinese characters are rejected', () => {
    const errs = validateFields([field('a', '结果')]);
    assert.match(errs.a, /Chinese characters/);
  });

  test('dots are rejected', () => {
    const errs = validateFields([field('a', 'user.name')]);
    assert.match(errs.a, /Dots/);
  });

  test('control characters are rejected', () => {
    const errs = validateFields([field('a', 'bad\u0001name')]);
    assert.match(errs.a, /Control characters/);
  });

  test('valid primitive field names pass', () => {
    const errs = validateFields([
      field('a', 'result', 'string'),
      field('b', 'count', 'integer'),
      field('c', 'ratio', 'number'),
      field('d', 'ok', 'boolean'),
    ]);
    assert.deepEqual(errs, {});
    assert.equal(hasErrors(errs), false);
  });
});
