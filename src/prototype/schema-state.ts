/**
 * PROTOTYPE — shared types for structured output schema prototype.
 */

export type FieldType = 'string' | 'integer' | 'number' | 'boolean';

export interface SchemaField {
  id: string;
  name: string;
  type: FieldType;
}

export interface SchemaState {
  fields: SchemaField[];
  errors: Record<string, string>; // field id → error message
  globalError: string | null;
}

let _counter = 0;
export function newFieldId(): string {
  return `f_${++_counter}`;
}

export function defaultState(): SchemaState {
  return {
    fields: [{ id: newFieldId(), name: 'result', type: 'string' }],
    errors: {},
    globalError: null,
  };
}

export function validateFields(fields: SchemaField[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const names = new Set<string>();

  for (const f of fields) {
    // Empty name
    if (!f.name.trim()) {
      errors[f.id] = 'Field name cannot be empty';
      continue;
    }
    // Chinese characters
    if (/[\u4e00-\u9fff]/.test(f.name)) {
      errors[f.id] = 'Chinese characters not allowed';
    }
    // Dots
    if (f.name.includes('.')) {
      errors[f.id] = 'Dots (.) not allowed';
    }
    // Control characters
    if (/[\x00-\x1f]/.test(f.name)) {
      errors[f.id] = 'Control characters not allowed';
    }
    // Duplicate
    if (names.has(f.name)) {
      errors[f.id] = `Duplicate field name "${f.name}"`;
    }
    names.add(f.name);
  }

  return errors;
}

export function canSave(state: SchemaState): boolean {
  if (state.fields.length === 0) return false;
  const errors = validateFields(state.fields);
  return Object.keys(errors).length === 0;
}
