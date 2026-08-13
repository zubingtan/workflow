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
import { useEffect, useId, useRef, useState } from 'react';

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
  const descriptionId = useId();

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
    <fieldset
      data-structured-output-editor
      aria-describedby={descriptionId}
      className="mt-1 min-w-0 border-0 p-0"
    >
      <legend className="mb-1.5 block text-xs font-medium">Structured Output Schema</legend>
      <p
        id={descriptionId}
        data-structured-output-description
        className="mb-2 text-xs leading-snug text-muted-foreground"
      >
        Define the values this agent returns. Every field is required in the output contract.
      </p>

      {/* Field rows — continuous block (Variant A) */}
      <section
        data-structured-output-fields-section
        aria-label="Structured output fields"
        className="min-w-0"
      >
        <div
          data-structured-output-fields
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
                data-slot="field"
                data-invalid={err ? 'true' : undefined}
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
                    aria-label={`Structured output field ${field.name || idx + 1}`}
                    aria-invalid={err ? 'true' : undefined}
                    value={field.name}
                    onChange={(event) => updateField(field.id, { name: event.target.value })}
                    placeholder="field_name"
                    className="flex-1 border-0 bg-transparent"
                    disabled={readonly}
                  />
                  <Select
                    aria-label={`Structured output type ${field.name || idx + 1}`}
                    aria-invalid={err ? 'true' : undefined}
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
                    disabled={readonly || fields.length <= 1}
                    aria-label={`Remove field ${field.name || idx + 1}`}
                    title={fields.length <= 1 ? 'At least one field is required' : 'Remove field'}
                  >
                    <MinusCircle />
                  </Button>
                </div>
                {/* Field-level error right under its row — the reason is always
                    visible next to the offending field, never a bare red row. */}
                {err && (
                  <div
                    role="alert"
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
      </section>

      {/* Add field — dashed row connected under the block */}
      {!readonly && (
        <section data-structured-output-actions aria-label="Structured output actions">
          {fields.length <= 1 && (
            <p
              data-structured-output-min-fields
              role="status"
              className="mb-1 ml-2 text-xs text-muted-foreground"
            >
              At least one field is required.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            data-structured-output-add-field
            aria-label="Add field"
            className="mt-1 w-full justify-start border-dashed text-muted-foreground"
            onClick={addField}
          >
            <PlusCircle data-icon="inline-start" />
            <span className="text-xs">Add Field</span>
          </Button>
        </section>
      )}

      {/* Global error (block-level, e.g. last-field deletion guard) */}
      {globalError && (
        <span role="alert" className="mt-1 ml-2 block text-xs text-destructive">
          {globalError}
        </span>
      )}

      {/* Live output JSON preview */}
      {fields.length > 0 && (
        <section
          data-structured-output-preview
          aria-label="Output JSON Preview"
          className="mt-2 min-w-0 rounded-md bg-muted p-2"
        >
          <h3 className="mb-1 block text-xs font-medium">Output JSON Preview</h3>
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
        </section>
      )}
    </fieldset>
  );
}
