/**
 * PROTOTYPE — Variant B: Modal Editor (弹窗编辑).
 * Panel shows a compact summary; editing happens in a Modal.
 */
import { useState, useCallback } from 'react';

import { Button, Input, Select, Typography, Modal, Tag, Badge } from '@douyinfe/semi-ui';
import { IconEdit, IconMinusCircle, IconPlusCircle } from '@douyinfe/semi-icons';

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

export default function VariantB({ readonly = false }: { readonly?: boolean }) {
  const [state, setState] = useState(defaultState);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<SchemaField[]>([]);

  const openEditor = useCallback(() => {
    setDraft(state.fields.map((f) => ({ ...f })));
    setModalOpen(true);
  }, [state.fields]);

  const updateDraft = useCallback((id: string, patch: Partial<SchemaField>) => {
    setDraft((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const removeDraft = useCallback((id: string) => {
    setDraft((prev) => (prev.length <= 1 ? prev : prev.filter((f) => f.id !== id)));
  }, []);

  const addDraft = useCallback(() => {
    setDraft((prev) => [...prev, { id: newFieldId(), name: '', type: 'string' as FieldType }]);
  }, []);

  const confirmSave = useCallback(() => {
    const errors = validateFields(draft);
    if (Object.keys(errors).length > 0) return;
    if (draft.length === 0) return;
    setState((prev) => ({ ...prev, fields: draft, errors: {} }));
    setModalOpen(false);
  }, [draft]);

  const errors = validateFields(draft);
  const canSave = Object.keys(errors).length === 0 && draft.length > 0;

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
          Click "Edit" to configure the output fields.
        </Typography.Text>
      </div>

      {/* Summary banner */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'var(--semi-color-fill-0)',
          borderRadius: 6,
          border: '1px solid var(--semi-color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Typography.Text strong style={{ fontSize: 14 }}>
            {state.fields.length} field{state.fields.length > 1 ? 's' : ''}
          </Typography.Text>
          <div style={{ display: 'flex', gap: 6 }}>
            {state.fields.map((f) => (
              <Tag key={f.id} color={TYPE_COLORS[f.type]} size="small">
                {f.name}: {f.type}
              </Tag>
            ))}
          </div>
        </div>
        {!readonly && (
          <Button icon={<IconEdit />} theme="borderless" size="small" onClick={openEditor}>
            Edit
          </Button>
        )}
      </div>

      {/* Schema preview */}
      <div
        style={{
          marginTop: 16,
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
            color: 'var(--semi-color-text-0)',
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

      {/* Modal Editor */}
      <Modal
        title="Edit Output Schema"
        visible={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button theme="borderless" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button theme="solid" disabled={!canSave} onClick={confirmSave}>
              Save
            </Button>
          </div>
        }
        width={600}
        bodyStyle={{ maxHeight: 500, overflow: 'auto' }}
      >
        <div style={{ marginBottom: 16 }}>
          <Typography.Text type="secondary" size="small">
            All fields are required. Supported types: string, integer, number, boolean.
          </Typography.Text>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {draft.map((field, idx) => {
            const err = errors[field.id];
            return (
              <div key={field.id}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: 12,
                    background: 'var(--semi-color-fill-0)',
                    borderRadius: 6,
                    border: err ? '1px solid var(--semi-color-danger)' : '1px solid transparent',
                  }}
                >
                  <Badge count={idx + 1} type={err ? 'danger' : 'primary'} />
                  <Input
                    value={field.name}
                    onChange={(v) => updateDraft(field.id, { name: v })}
                    placeholder="field_name"
                    size="small"
                    style={{ flex: 1 }}
                  />
                  <Select
                    value={field.type}
                    onChange={(v) => updateDraft(field.id, { type: v as FieldType })}
                    optionList={TYPE_OPTIONS}
                    size="small"
                    style={{ width: 120 }}
                  />
                  <Button
                    icon={<IconMinusCircle />}
                    theme="borderless"
                    size="small"
                    type="danger"
                    onClick={() => removeDraft(field.id)}
                    disabled={draft.length <= 1}
                  />
                </div>
                {err && (
                  <Typography.Text
                    type="danger"
                    size="small"
                    style={{ marginLeft: 42, marginTop: 2, display: 'block' }}
                  >
                    {err}
                  </Typography.Text>
                )}
              </div>
            );
          })}
        </div>

        <Button
          icon={<IconPlusCircle />}
          theme="borderless"
          size="small"
          onClick={addDraft}
          style={{ marginTop: 10 }}
        >
          Add Field
        </Button>

        {draft.length === 0 && (
          <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 8 }}>
            At least one field is required.
          </Typography.Text>
        )}
      </Modal>
    </div>
  );
}
