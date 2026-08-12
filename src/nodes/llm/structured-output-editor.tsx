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

import { MinusCircle, PlusCircle } from 'lucide-react';

import { Button, Input, Select } from '@/components/ui';

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
  description?: string;
}

const rowBase: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--app-space-2)',
  padding: 'var(--app-space-2)',
  borderBottom: '1px solid var(--border)',
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

  return (
    <div style={{ marginTop: 4 }}>
      <div className="mb-1.5 block text-xs font-medium">Structured Output Schema</div>

      {/* Field rows — continuous block (Variant A) */}
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--app-radius-md)',
          overflow: 'hidden',
        }}
      >
        {fields.length === 0 && (
          <div style={{ ...rowBase, borderBottom: 'none', color: 'var(--muted-foreground)' }}>
            <span className="text-xs">No fields declared</span>
          </div>
        )}
        {fields.map((field, idx) => {
          const err = errors[field.id];
          const isLast = idx === fields.length - 1;
          return (
            <div
              key={field.id}
              style={{
                background: err
                  ? 'color-mix(in oklch, var(--destructive) 10%, transparent)'
                  : undefined,
              }}
            >
              <div
                style={{
                  ...rowBase,
                  borderLeftColor: err ? 'var(--destructive)' : 'transparent',
                  borderBottom: isLast ? 'none' : '1px solid var(--border)',
                }}
              >
                <span className="min-w-6 rounded-md bg-muted px-1.5 py-0.5 text-center text-xs">
                  {idx + 1}
                </span>
                <Input
                  value={field.name}
                  onChange={(event) => updateField(field.id, { name: event.target.value })}
                  placeholder="field_name"
                  className="flex-1 border-0 bg-transparent"
                  disabled={readonly}
                />
                <Select
                  value={field.type}
                  onChange={(event) =>
                    updateField(field.id, {
                      type: event.currentTarget.value as SchemaField['type'],
                    })
                  }
                  className="w-[110px]"
                  disabled={readonly}
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="destructive"
                  size="icon-sm"
                  onClick={() => removeField(field.id)}
                  disabled={readonly}
                  aria-label={`Remove field ${field.name || idx + 1}`}
                >
                  <MinusCircle />
                </Button>
              </div>
              {/* Field-level error right under its row — the reason is always
                  visible next to the offending field, never a bare red row. */}
              {err && (
                <div
                  style={{
                    padding: '0 var(--app-space-2) var(--app-space-2) 11px',
                    color: 'var(--destructive)',
                    fontSize: 'var(--app-font-size-xs)',
                    borderBottom: isLast ? 'none' : '1px solid var(--border)',
                  }}
                >
                  {err}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add field — dashed row connected under the block */}
      {!readonly && (
        <div
          onClick={addField}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              addField();
            }
          }}
          role="button"
          aria-label="Add field"
          tabIndex={0}
          className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--app-space-2)',
            padding: 'var(--app-space-1) var(--app-space-2)',
            marginTop: 'var(--app-space-1)',
            borderRadius: 'var(--app-radius-md)',
            cursor: 'pointer',
            color: 'var(--muted-foreground)',
            border: '1px dashed var(--border)',
          }}
        >
          <PlusCircle />
          <span className="text-xs">Add Field</span>
        </div>
      )}

      {/* Global error (block-level, e.g. last-field deletion guard) */}
      {globalError && (
        <span className="mt-1 ml-2 block text-xs text-destructive">{globalError}</span>
      )}

      {/* Live output JSON preview */}
      {fields.length > 0 && (
        <div
          style={{
            marginTop: 'var(--app-space-2)',
            padding: 'var(--app-space-2)',
            background: 'var(--muted)',
            borderRadius: 'var(--app-radius-md)',
          }}
        >
          <div className="mb-1 block text-xs font-medium">Output JSON Preview</div>
          <pre
            style={{
              margin: 0,
              fontSize: 'var(--app-font-size-xs)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: hasErrors(errors) ? 'var(--destructive)' : 'var(--foreground)',
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
