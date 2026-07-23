import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Button,
  Table,
  Modal,
  Form,
  Input,
  Typography,
  Space,
  Popconfirm,
  Toast,
} from '@douyinfe/semi-ui';
import { IconCopy, IconDelete, IconEdit, IconPlus, IconPlay } from '@douyinfe/semi-icons';

import * as api from './api';

// ---------- Agent list + CRUD ----------
export function AgentManager() {
  const [agents, setAgents] = useState<api.AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<api.AgentDef | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .listAgents()
      .then(setAgents)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  const remove = async (id: string) => {
    await api.deleteAgent(id);
    reload();
  };

  const copy = async (id: string) => {
    await api.copyAgent(id);
    reload();
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title heading={4} style={{ margin: 0 }}>
          Agents
        </Typography.Title>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setCreating(true)}>
          New Agent
        </Button>
      </div>
      <Table
        dataSource={agents}
        loading={loading}
        rowKey="id"
        pagination={false}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Model', dataIndex: 'model' },
          { title: 'Base URL', dataIndex: 'provider_base_url' },
          {
            title: 'Actions',
            render: (_, record: api.AgentDef) => (
              <Space>
                <Button size="small" icon={<IconEdit />} onClick={() => setEditing(record)}>
                  Edit
                </Button>
                <Button size="small" icon={<IconCopy />} onClick={() => copy(record.id)}>
                  Copy
                </Button>
                <Popconfirm title="Delete this agent?" onConfirm={() => remove(record.id)}>
                  <Button size="small" type="danger" icon={<IconDelete />}>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {(creating || editing) && (
        <AgentFormModal
          agent={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={reload}
        />
      )}
    </div>
  );
}

function AgentFormModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: api.AgentDef | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!agent;
  const [form, setForm] = useState({
    name: agent?.name ?? '',
    model: agent?.model ?? 'deepseek-v4-flash',
    provider_base_url: agent?.provider_base_url ?? '',
    provider_api_key_env: agent?.provider_api_key_env ?? 'COPILOT_PROVIDER_API_KEY',
    system_prompt: agent?.system_prompt ?? '',
    temperature: agent?.temperature ?? 0.7,
  });
  const [saving, setSaving] = useState(false);
  const [envVars, setEnvVars] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState('');
  const [testError, setTestError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api
      .getEnvVars()
      .then(setEnvVars)
      .catch(() => setEnvVars([]));
  }, []);

  const submit = async () => {
    setSaving(true);
    try {
      if (isEdit) {
        await api.updateAgent(agent!.id, form);
      } else {
        await api.createAgent(form);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTestOutput('');
    setTestError('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await api.testAgent(form, controller.signal);
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const msg = err.error || `HTTP ${res.status}`;
        setTestError(msg);
        Toast.error(`Test failed: ${msg}`);
        setTesting(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotError = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim());
            if (ev.type === 'content_delta') setTestOutput((p) => p + ev.content);
            else if (ev.type === 'error') {
              setTestError(ev.message);
              Toast.error(`Test failed: ${ev.message}`);
              gotError = true;
            }
          } catch {
            // skip
          }
        }
      }
      if (!gotError) Toast.success('Test passed');
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const msg = err.message || 'Test failed';
        setTestError(msg);
        Toast.error(`Test failed: ${msg}`);
      }
    } finally {
      setTesting(false);
      abortRef.current = null;
    }
  };

  return (
    <Modal
      title={isEdit ? 'Edit Agent' : 'New Agent'}
      visible
      onOk={submit}
      onCancel={onClose}
      confirmLoading={saving}
      closeOnEsc
      style={{ width: 560 }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button
            icon={<IconPlay />}
            theme="borderless"
            loading={testing}
            onClick={runTest}
            disabled={!form.provider_base_url || !form.provider_api_key_env || !form.model}
          >
            {testing ? 'Testing...' : 'Test'}
          </Button>
          <Space>
            <Button theme="borderless" onClick={onClose}>
              Cancel
            </Button>
            <Button theme="solid" onClick={submit} loading={saving}>
              {isEdit ? 'Save' : 'Create'}
            </Button>
          </Space>
        </div>
      }
    >
      <Form
        layout="vertical"
        onChange={(v) => setForm((prev) => ({ ...prev, ...v }))}
        initValues={form}
      >
        <Form.Input field="name" label="Name" rules={[{ required: true }]} />
        <Form.Input field="model" label="Model" rules={[{ required: true }]} />
        <Form.Input
          field="provider_base_url"
          label="Provider Base URL"
          rules={[{ required: true }]}
        />
        <Form.AutoComplete
          field="provider_api_key_env"
          label="API Key Env Var"
          data={envVars}
          rules={[{ required: true }]}
          placeholder="Select or type env var"
        />
        <Form.TextArea field="system_prompt" label="System Prompt" rows={3} />
        <Form.InputNumber field="temperature" label="Temperature" min={0} max={2} step={0.1} />
      </Form>
      {(testOutput || testError) && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: 'var(--semi-color-fill-0)',
            borderRadius: 4,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            maxHeight: 150,
            overflow: 'auto',
          }}
        >
          {testError && <Typography.Text type="danger">{testError}</Typography.Text>}
          {testOutput}
        </div>
      )}
    </Modal>
  );
}

// ---------- Workflow list + CRUD ----------
export function WorkflowManager({ onOpen }: { onOpen: (id: string) => void }) {
  const [workflows, setWorkflows] = useState<api.WorkflowMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = useCallback(() => {
    setLoading(true);
    api
      .listWorkflows()
      .then(setWorkflows)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  const remove = async (id: string) => {
    await api.deleteWorkflow(id);
    reload();
  };

  const copy = async (id: string) => {
    await api.copyWorkflow(id);
    reload();
  };

  const create = async () => {
    if (!newName.trim()) return;
    const wf = await api.createWorkflow(newName.trim(), { nodes: [], edges: [] });
    setCreating(false);
    setNewName('');
    onOpen(wf.id);
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title heading={4} style={{ margin: 0 }}>
          Workflows
        </Typography.Title>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setCreating(true)}>
          New Workflow
        </Button>
      </div>
      <Table
        dataSource={workflows}
        loading={loading}
        rowKey="id"
        pagination={false}
        columns={[
          {
            title: 'Name',
            dataIndex: 'name',
            render: (name: string, record: api.WorkflowMeta) => (
              <Button
                theme="borderless"
                onClick={() => onOpen(record.id)}
                style={{ fontWeight: 600 }}
              >
                {name}
              </Button>
            ),
          },
          { title: 'Updated', dataIndex: 'updated_at' },
          {
            title: 'Actions',
            render: (_, record: api.WorkflowMeta) => (
              <Space>
                <Button size="small" onClick={() => onOpen(record.id)}>
                  Open
                </Button>
                <Button size="small" icon={<IconCopy />} onClick={() => copy(record.id)}>
                  Copy
                </Button>
                <Popconfirm title="Delete this workflow?" onConfirm={() => remove(record.id)}>
                  <Button size="small" type="danger" icon={<IconDelete />}>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title="New Workflow"
        visible={creating}
        onOk={create}
        onCancel={() => setCreating(false)}
        closeOnEsc
      >
        <Input placeholder="Workflow name" value={newName} onChange={setNewName} autoFocus />
      </Modal>
    </div>
  );
}
