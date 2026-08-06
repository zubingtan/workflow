/**
 * Structured Output Schema state (#247) — React-free field-list model for the
 * Agent Node outputs editor.
 *
 * Persistence contract: the node's `data.outputs` stays a FlowGram IJsonSchema
 * (object + primitive properties). This module only converts between that
 * persisted shape and the editable flat field list; it never invents a second
 * storage format.
 *
 * React-free so `node --test` can cover the validation rules directly.
 */

/** @typedef {'string'|'integer'|'number'|'boolean'} FieldType */
/** @typedef {{ id: string, name: string, type: FieldType, description?: string }} SchemaField */

const FIELD_TYPES = ['string', 'integer', 'number', 'boolean'];

/**
 * Keys inherited from Object.prototype. Using them as field names either
 * pollutes the prototype (`__proto__`) or silently disappears from
 * `Object.keys`/JSON round-trips (`constructor`, `toString`, ...) — so they
 * are rejected outright, on both the UI and the backend.
 */
export const RESERVED_FIELD_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  '_executionDetail',
]);

let counter = 0;
export function newFieldId() {
  return `so_${++counter}_${Date.now().toString(36)}`;
}

/**
 * Decode persisted IJsonSchema outputs → editable field list (flat object).
 * @param {object|undefined|null} schema
 * @returns {SchemaField[]}
 */
export function schemaToFields(schema) {
  if (!schema || typeof schema !== 'object' || schema.type !== 'object' || !schema.properties) {
    return [];
  }
  return Object.entries(schema.properties)
    .filter(([, def]) => def && typeof def === 'object')
    .map(([name, def]) => ({
      id: newFieldId(),
      name,
      type: FIELD_TYPES.includes(def.type) ? def.type : 'string',
      ...(typeof def.description === 'string' ? { description: def.description } : {}),
    }));
}

/**
 * Encode a valid field list → persisted IJsonSchema. Returns null when the
 * list is empty — callers must keep the previous persisted value in that
 * case (an empty declaration would silently drop the outputs contract).
 * @param {SchemaField[]} fields
 * @returns {{type: 'object', properties: Record<string, {type: string, description?: string}>}|null}
 */
export function fieldsToSchema(fields) {
  if (fields.length === 0) return null;
  // Null-prototype bag: a plain `{}` would let a `__proto__` field name set
  // the object's prototype instead of an own property, silently dropping it.
  const properties = Object.create(null);
  for (const f of fields) {
    properties[f.name] = {
      type: f.type,
      ...(f.description !== undefined ? { description: f.description } : {}),
    };
  }
  return { type: 'object', properties };
}

/**
 * Field-level validation (#242/#247): empty key, duplicate key, Chinese
 * characters, dots, control characters. All fields are required by the
 * contract — enforced at runtime by the backend's compileStrictSchema.
 * @param {SchemaField[]} fields
 * @returns {Record<string, string>} field id → error message
 */
export function validateFields(fields) {
  const errors = {};
  const seen = new Set();
  for (const f of fields) {
    const name = f.name.trim();
    if (!name) {
      errors[f.id] = 'Field name cannot be empty';
      continue;
    }
    if (name !== f.name) {
      // Leading/trailing whitespace would persist a name that differs from
      // the validated one — reject it instead of silently trimming.
      errors[f.id] = 'Leading or trailing spaces are not allowed';
    }
    if (RESERVED_FIELD_NAMES.has(name)) {
      errors[f.id] = `"${name}" is a reserved name`;
    }
    if (/[\u4e00-\u9fff]/.test(name)) {
      errors[f.id] = 'Chinese characters are not allowed';
    }
    if (name.includes('.')) {
      errors[f.id] = 'Dots (.) are not allowed';
    }
    if (/[\x00-\x1f]/.test(name)) {
      errors[f.id] = 'Control characters are not allowed';
    }
    if (seen.has(name)) {
      errors[f.id] = `Duplicate field name "${name}"`;
    }
    seen.add(name);
  }
  return errors;
}

/** @param {Record<string, string>} errors */
export function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

/** Human-readable type label for the type Select options. */
export const TYPE_OPTIONS = FIELD_TYPES.map((t) => ({ value: t, label: t }));
