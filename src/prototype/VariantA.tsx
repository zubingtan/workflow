/**
 * PROTOTYPE — Variant A: Inline Key-Value Form (内嵌表单).
 * Each field is a row directly in the panel: name input + type select + delete.
 * Errors shown inline below each row.
 */
import { useState, useCallback } from 'react';

import { Button, Input, Select, Typography, Tag } from '@douyinfe/semi-ui';
import { IconMinusCircle, IconPlusCircle } from '@douyinfe/semi-icons';

import type { SchemaField, FieldType } from './schema-state';
import { defaultState, validateFields, newFieldId } from './schema-state';

const TYPE_OPTIONS = [
  { value: 'string', label: 'string' },
  { value: 'integer', label: 'integer' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
];

export default function VariantA({ readonly = false }: { readonly?: boolean }) {
  const [state, setState] = useState(defaultState);

  const updateField = useCallback((id: string, patch: Partial<SchemaField>) => {
    setState((prev) => {
      const fields = prev.fields.map((f) => (f.id === id ? { ...f, ...patch } : f));
      return { ...prev, fields, errors: validateFields(fields) };
    });
  }, []);

  const removeField = useCallback((id: string) => {
    setState((prev) => {
      if (prev.fields.length <= 1) {
        return { ...prev, globalError: 'At least one field is required' };
      }
      const fields = prev.fields.filter((f) => f.id !== id);
      return { ...prev, fields, errors: validateFields(fields), globalError: null };
    });
  }, []);

  const addField = useCallback(() => {
    setState((prev) => ({
      ...prev,
      fields: [...prev.fields, { id: newFieldId(), name: '', type: 'string' as FieldType }],
      errors: {},
      globalError: null,
    }));
  }, []);

  const hasErrors = Object.keys(state.errors).length > 0;

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '40px auto',
        padding: 24,
        background: 'var(--semi-color-bg-0)',
        borderRadius: 8,
        border: '1px solid var(--semi-color-border)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Panel header */}
      <div style={{ marginBottom: 20 }}>
        <Typography.Title heading={5} style={{ margin: 0 }}>
          Structured Output Schema
        </Typography.Title>
        <Typography.Text type="secondary" size="small">
          Declare the fields the AI agent must output as JSON. All fields are required.
        </Typography.Text>
      </div>

      {/* Field rows — continuous block, rows connected by dividers */}
      <div
        style={{
          border: '1px solid var(--semi-color-border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {state.fields.map((field, idx) => {
          const err = state.errors[field.id];
          const isLast = idx === state.fields.length - 1;
          return (
            <div
              key={field.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: err
                  ? 'var(--semi-color-danger-light-default)'
                  : 'var(--semi-color-bg-0)',
                borderBottom: isLast ? 'none' : '1px solid var(--semi-color-border)',
                borderLeft: err ? '3px solid var(--semi-color-danger)' : '3px solid transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!err)
                  (e.currentTarget as HTMLElement).style.background = 'var(--semi-color-fill-0)';
              }}
              onMouseLeave={(e) => {
                if (!err)
                  (e.currentTarget as HTMLElement).style.background = 'var(--semi-color-bg-0)';
              }}
            >
              <Tag type="light" size="small" style={{ minWidth: 28, textAlign: 'center' }}>
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
                onChange={(v) => updateField(field.id, { type: v as FieldType })}
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
                disabled={readonly || state.fields.length <= 1}
              />
            </div>
          );
        })}
      </div>

      {/* Add field — connected as the last row of the block */}
      {!readonly && (
        <div
          onClick={addField}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            marginTop: 4,
            borderRadius: 6,
            cursor: 'pointer',
            color: 'var(--semi-color-text-2)',
            border: '1px dashed var(--semi-color-border)',
            transition: 'border-color 0.15s, color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--semi-color-primary)';
            (e.currentTarget as HTMLElement).style.color = 'var(--semi-color-primary)';
            (e.currentTarget as HTMLElement).style.background =
              'var(--semi-color-primary-light-default)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--semi-color-border)';
            (e.currentTarget as HTMLElement).style.color = 'var(--semi-color-text-2)';
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }}
        >
          <IconPlusCircle size="small" />
          <Typography.Text size="small">Add Field</Typography.Text>
        </div>
      )}

      {/* Inline error detail under the block */}
      {Object.entries(state.errors).map(([id, msg]) => (
        <Typography.Text
          key={id}
          type="danger"
          size="small"
          style={{ display: 'block', marginTop: 4, marginLeft: 12 }}
        >
          {msg}
        </Typography.Text>
      ))}

      {state.globalError && (
        <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 8 }}>
          {state.globalError}
        </Typography.Text>
      )}

      {/* Schema preview */}
      <div
        style={{
          marginTop: 20,
          padding: 12,
          background: 'var(--semi-color-fill-1)',
          borderRadius: 6,
        }}
      >
        <Typography.Text size="small" strong style={{ display: 'block', marginBottom: 6 }}>
          Output JSON Preview
        </Typography.Text>
        <pre
          style={{
            margin: 0,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: hasErrors ? 'var(--semi-color-danger)' : 'var(--semi-color-text-0)',
          }}
        >
          {JSON.stringify(
            Object.fromEntries(
              state.fields.map((f) => [
                f.name,
                f.type === 'string' ? '...' : f.type === 'boolean' ? true : 0,
              ])
            ),
            null,
            2
          )}
        </pre>
      </div>

      {/* Capability error example */}
      <div
        style={{
          marginTop: 16,
          padding: '10px 14px',
          background: 'var(--semi-color-warning-light-default)',
          borderRadius: 6,
          border: '1px solid var(--semi-color-warning)',
        }}
      >
        <Typography.Text size="small" type="warning" strong>
          Provider Capability Error (example)
        </Typography.Text>
        <Typography.Text size="small" style={{ display: 'block', marginTop: 4 }}>
          The configured model "gpt-4o-mini" does not support json_schema structured output. Please
          change the model or disable structured output in the node settings.
        </Typography.Text>
      </div>

      {/* Save button */}
      {!readonly && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Button theme="solid" disabled={hasErrors || state.fields.length === 0}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
