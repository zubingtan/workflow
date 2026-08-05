/**
 * PROTOTYPE — Variant C: Card List (卡片列表).
 * Each field is a card with inline edit, type badge, and delete.
 * Add field is a dashed-border card.
 */
import { useState, useCallback } from 'react';

import { Button, Input, Select, Typography, Tag } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';

import type { SchemaField, FieldType } from './schema-state';
import { defaultState, validateFields, newFieldId } from './schema-state';

const TYPE_OPTIONS = [
  { value: 'string', label: 'string' },
  { value: 'integer', label: 'integer' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
];

const TYPE_COLORS: Record<string, 'blue' | 'green' | 'orange' | 'purple'> = {
  string: 'blue',
  integer: 'green',
  number: 'orange',
  boolean: 'purple',
};

export default function VariantC({ readonly = false }: { readonly?: boolean }) {
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
          Each field is a card. Fill in the name and select a type.
        </Typography.Text>
      </div>

      {/* Field cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {state.fields.map((field) => {
          const err = state.errors[field.id];
          return (
            <div
              key={field.id}
              style={{
                padding: 14,
                background: 'var(--semi-color-bg-1)',
                borderRadius: 8,
                border: err
                  ? '2px solid var(--semi-color-danger)'
                  : '1px solid var(--semi-color-border)',
                boxShadow: err
                  ? '0 0 0 3px var(--semi-color-danger-light-default)'
                  : '0 1px 3px rgba(0,0,0,0.06)',
                transition: 'box-shadow 0.15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Type badge */}
                <Tag
                  color={TYPE_COLORS[field.type]}
                  size="small"
                  style={{ minWidth: 60, textAlign: 'center' }}
                >
                  {field.type}
                </Tag>

                {/* Name input */}
                <Input
                  value={field.name}
                  onChange={(v) => updateField(field.id, { name: v })}
                  placeholder="field_name"
                  size="small"
                  style={{ flex: 1 }}
                  disabled={readonly}
                />

                {/* Type selector */}
                <Select
                  value={field.type}
                  onChange={(v) => updateField(field.id, { type: v as FieldType })}
                  optionList={TYPE_OPTIONS}
                  size="small"
                  style={{ width: 100 }}
                  disabled={readonly}
                />

                {/* Delete */}
                <Button
                  icon={<IconDelete />}
                  theme="borderless"
                  size="small"
                  type="danger"
                  onClick={() => removeField(field.id)}
                  disabled={readonly || state.fields.length <= 1}
                />
              </div>

              {err && (
                <Typography.Text
                  type="danger"
                  size="small"
                  style={{ display: 'block', marginTop: 6, marginLeft: 70 }}
                >
                  {err}
                </Typography.Text>
              )}
            </div>
          );
        })}
      </div>

      {/* Add field card */}
      {!readonly && (
        <div
          onClick={addField}
          style={{
            marginTop: 10,
            padding: 14,
            borderRadius: 8,
            border: '2px dashed var(--semi-color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: 'pointer',
            color: 'var(--semi-color-text-2)',
            transition: 'border-color 0.15s, color 0.15s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--semi-color-primary)';
            (e.currentTarget as HTMLElement).style.color = 'var(--semi-color-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = 'var(--semi-color-border)';
            (e.currentTarget as HTMLElement).style.color = 'var(--semi-color-text-2)';
          }}
        >
          <IconPlus />
          <Typography.Text size="small">Add Field</Typography.Text>
        </div>
      )}

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
