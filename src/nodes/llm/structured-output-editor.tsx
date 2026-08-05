/**
 * Structured Output Schema editor (#247) — Variant A (inline form, continuous
 * row block) per the #245 prototype decision.
 *
 * Edits the Agent Node's `data.outputs` IJsonSchema through a flat field list.
 * Persistence is real-time: every valid edit emits the compiled IJsonSchema
 * via `onChange`; invalid intermediate states (empty/duplicate/illegal keys)
 * never touch the persisted schema — the variable tree keeps the last valid
 * declaration and errors are shown inline.
 *
 * State constraints:
 *   - `result` is NOT special: it is only the onAdd default. Deleting or
 *     renaming it never auto-restores it.
 *   - The last remaining field cannot be deleted (empty schema is invalid).
 *   - readonly (canvas card / history view) disables all editing.
 */
import { useEffect, useRef, useState } from 'react';

import { Button, Input, Select, Tag, Typography } from '@douyinfe/semi-ui';
import { IconMinusCircle, IconPlusCircle } from '@douyinfe/semi-icons';

import type { JsonSchema } from '../../typings/json-schema';
import {
  fieldsToSchema,
  hasErrors,
  newFieldId,
  schemaToFields,
  TYPE_OPTIONS,
  validateFields,
} from './schema-state.mjs';

/** Field list model mirrored from schema-state.mjs (React-free seam). */
interface SchemaField {
  id: string;
  name: string;
  type: 'string' | 'integer' | 'number' | 'boolean';
}

const rowBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid var(--semi-color-border)',
  borderLeft: '3px solid transparent',
};

export function StructuredOutputEditor({
  value,
  onChange,
  readonly = false,
}: {
  value?: JsonSchema | null;
  onChange: (schema: JsonSchema) => void;
  readonly?: boolean;
}) {
  const [fields, setFields] = useState<SchemaField[]>(() => schemaToFields(value));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const lastEmittedRef = useRef<string>(JSON.stringify(value ?? null));

  // External sync: only rebuild when the persisted schema changed from
  // somewhere else (undo / document load / other editors). Local edits that
  // were emitted are recognized by lastEmittedRef and left untouched, so
  // typing never loses focus.
  useEffect(() => {
    if (JSON.stringify(value ?? null) !== lastEmittedRef.current) {
      setFields(schemaToFields(value));
      setErrors({});
      setGlobalError(null);
    }
  }, [value]);

  /** Commit a new field list: validate locally, emit only when valid. */
  const commitFields = (next: SchemaField[], opts?: { globalError?: string | null }) => {
    setFields(next);
    const errs = validateFields(next);
    setErrors(errs);
    setGlobalError(opts?.globalError ?? null);
    if (!hasErrors(errs) && next.length > 0) {
      const schema = fieldsToSchema(next);
      if (schema) {
        lastEmittedRef.current = JSON.stringify(schema);
        onChange(schema);
      }
    }
  };

  const updateField = (id: string, patch: Partial<SchemaField>) => {
    commitFields(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeField = (id: string) => {
    if (fields.length <= 1) {
      setGlobalError('At least one field is required');
      return;
    }
    commitFields(fields.filter((f) => f.id !== id));
  };

  const addField = () => {
    setGlobalError(null);
    commitFields([...fields, { id: newFieldId(), name: '', type: 'string' }]);
  };

  const errorList = Object.values(errors);

  return (
    <div style={{ marginTop: 4 }}>
      <Typography.Text size="small" strong style={{ display: 'block', marginBottom: 6 }}>
        Structured Output Schema
      </Typography.Text>

      {/* Field rows — continuous block (Variant A) */}
      <div
        style={{
          border: '1px solid var(--semi-color-border)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {fields.length === 0 && (
          <div style={{ ...rowBase, borderBottom: 'none', color: 'var(--semi-color-text-2)' }}>
            <Typography.Text size="small">No fields declared</Typography.Text>
          </div>
        )}
        {fields.map((field, idx) => {
          const err = errors[field.id];
          const isLast = idx === fields.length - 1;
          return (
            <div
              key={field.id}
              style={{
                ...rowBase,
                background: err ? 'var(--semi-color-danger-light-default)' : undefined,
                borderLeftColor: err ? 'var(--semi-color-danger)' : 'transparent',
                borderBottom: isLast ? 'none' : '1px solid var(--semi-color-border)',
              }}
            >
              <Tag type="light" size="small" style={{ minWidth: 24, textAlign: 'center' }}>
                {idx + 1}
              </Tag>
              <Input
                value={field.name}
                onChange={(v) => updateField(field.id, { name: v })}
                placeholder="field_name"
                size="small"
                style={{ flex: 1, border: 'none', background: 'transparent' }}
                disabled={readonly}
              />
              <Select
                value={field.type}
                onChange={(v) => updateField(field.id, { type: v as SchemaField['type'] })}
                optionList={TYPE_OPTIONS}
                size="small"
                style={{ width: 110 }}
                disabled={readonly}
              />
              <Button
                icon={<IconMinusCircle />}
                theme="borderless"
                size="small"
                type="danger"
                onClick={() => removeField(field.id)}
                disabled={readonly}
                aria-label={`Remove field ${field.name || idx + 1}`}
              />
            </div>
          );
        })}
      </div>

      {/* Add field — dashed row connected under the block */}
      {!readonly && (
        <div
          onClick={addField}
          role="button"
          aria-label="Add field"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 8px',
            marginTop: 4,
            borderRadius: 6,
            cursor: 'pointer',
            color: 'var(--semi-color-text-2)',
            border: '1px dashed var(--semi-color-border)',
          }}
        >
          <IconPlusCircle size="small" />
          <Typography.Text size="small">Add Field</Typography.Text>
        </div>
      )}

      {/* Inline error detail under the block */}
      {errorList.map((msg, i) => (
        <Typography.Text
          key={i}
          type="danger"
          size="small"
          style={{ display: 'block', marginTop: 4, marginLeft: 10 }}
        >
          {msg}
        </Typography.Text>
      ))}
      {globalError && (
        <Typography.Text
          type="danger"
          size="small"
          style={{ display: 'block', marginTop: 4, marginLeft: 10 }}
        >
          {globalError}
        </Typography.Text>
      )}

      {/* Live output JSON preview */}
      {fields.length > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: 8,
            background: 'var(--semi-color-fill-1)',
            borderRadius: 6,
          }}
        >
          <Typography.Text size="small" strong style={{ display: 'block', marginBottom: 4 }}>
            Output JSON Preview
          </Typography.Text>
          <pre
            style={{
              margin: 0,
              fontSize: 11,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: hasErrors(errors) ? 'var(--semi-color-danger)' : 'var(--semi-color-text-0)',
            }}
          >
            {JSON.stringify(
              Object.fromEntries(
                fields.map((f) => [
                  f.name,
                  f.type === 'string' ? '...' : f.type === 'boolean' ? true : 0,
                ])
              ),
              null,
              2
            )}
          </pre>
        </div>
      )}
    </div>
  );
}
