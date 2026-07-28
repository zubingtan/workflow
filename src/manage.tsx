import { useCallback, useEffect, useMemo, useState } from 'react';

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
  Tooltip,
} from '@douyinfe/semi-ui';
import {
  IconCopy,
  IconDelete,
  IconEdit,
  IconPlus,
  IconPlay,
  IconHistory,
} from '@douyinfe/semi-icons';

import { useActiveRunCounts } from './use-active-run-counts';
import { newWorkflowTemplate } from './new-workflow-template.mjs';
import { HistoryModal } from './components/history-modal';
import * as api from './api';
import { ApiError } from './api';
import { useAgentExecution } from './agent-execution/use-agent-execution';

const PHASE_BADGE: Record<string, { text: string; color: string }> = {
  succeeded: { text: '成功', color: 'var(--semi-color-success)' },
  cancelled: { text: '已取消', color: 'var(--semi-color-tertiary)' },
  failed: { text: '失败', color: 'var(--semi-color-danger)' },
};

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
    provider_api_key: agent?.provider_api_key ?? '',
    system_prompt: agent?.system_prompt ?? '',
    temperature: agent?.temperature ?? 0.7,
  });
  const [saving, setSaving] = useState(false);

  // Agent Execution consumer (#54): the hook owns transport, SSE framing,
  // cancellation, and the phase state machine. The modal keeps only rendering.
  const exec = useAgentExecution({ config: form, prompt: undefined });

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

  const canTest = !!form.provider_base_url && !!form.provider_api_key && !!form.model;

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
          <Space>
            <Button
              icon={<IconPlay />}
              theme="borderless"
              loading={exec.isRunning}
              onClick={exec.run}
              disabled={!canTest || exec.isRunning}
            >
              {exec.isRunning ? '测试中...' : '测试'}
            </Button>
            {exec.isRunning && (
              <Button theme="borderless" onClick={exec.cancel}>
                取消
              </Button>
            )}
            {PHASE_BADGE[exec.phase] && (
              <Typography.Text size="small" style={{ color: PHASE_BADGE[exec.phase].color }}>
                {PHASE_BADGE[exec.phase].text}
              </Typography.Text>
            )}
          </Space>
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
        onValueChange={(values) => setForm((prev) => ({ ...prev, ...values }))}
        initValues={form}
      >
        <Form.Input field="name" label="Name" rules={[{ required: true }]} />
        <Form.Input field="model" label="Model" rules={[{ required: true }]} />
        <Form.Input
          field="provider_base_url"
          label="Provider Base URL"
          rules={[{ required: true }]}
        />
        <Form.Input
          field="provider_api_key"
          label="API Key"
          mode="password"
          rules={[{ required: true }]}
          placeholder="Enter API key"
        />
        <Form.TextArea field="system_prompt" label="System Prompt" rows={3} />
        <Form.InputNumber field="temperature" label="Temperature" min={0} max={2} step={0.1} />
      </Form>
      {exec.phase !== 'idle' && (exec.content || exec.error || exec.toolEvents.length > 0) && (
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
          {exec.error && <Typography.Text type="danger">{exec.error}</Typography.Text>}
          {exec.content}
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
  // Phase 7 (#159): History Modal entry from the management interface.
  const [historyFor, setHistoryFor] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .listWorkflows()
      .then(setWorkflows)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  // Phase 6 (#158): SSE-driven Delete-button gate. The hook opens one
  // EventSource per visible workflow and tracks queued+running counts.
  // Phase 7 (#159) §5: when the HistoryModal is open for a workflow, the
  // modal's own SSE stream owns that workflow's updates — drop the id from
  // the manager's subscription set so only one EventSource is open per
  // workflow (spec coordination requirement).
  const workflowIds = useMemo(
    () => workflows.filter((w) => w.id !== historyFor).map((w) => w.id),
    [workflows, historyFor]
  );
  const activeCounts = useActiveRunCounts(workflowIds);

  const remove = async (id: string) => {
    try {
      await api.deleteWorkflow(id);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'workflow_has_active_runs') {
        Toast.warning('请先取消运行中或排队中的实例再删除');
        reload(); // re-sync in case counts drifted
        return;
      }
      Toast.error(err instanceof Error ? err.message : 'Failed to delete workflow');
    }
  };

  const copy = async (id: string) => {
    await api.copyWorkflow(id);
    reload();
  };

  const create = async () => {
    if (!newName.trim()) return;
    const wf = await api.createWorkflow(newName.trim(), newWorkflowTemplate());
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
            render: (_, record: api.WorkflowMeta) => {
              const active = activeCounts[record.id] ?? 0;
              const deleteDisabled = active > 0;
              const deleteBtn = (
                <Button size="small" type="danger" icon={<IconDelete />} disabled={deleteDisabled}>
                  Delete
                </Button>
              );
              return (
                <Space>
                  <Button size="small" onClick={() => onOpen(record.id)}>
                    Open
                  </Button>
                  <Button size="small" icon={<IconCopy />} onClick={() => copy(record.id)}>
                    Copy
                  </Button>
                  {/* Phase 7 (#159): History entry — placed BEFORE Delete per spec. */}
                  <Button
                    size="small"
                    icon={<IconHistory />}
                    onClick={() => setHistoryFor(record.id)}
                  >
                    历史
                  </Button>
                  {deleteDisabled ? (
                    <Tooltip content="该 Workflow 有运行中或排队中的实例，请先取消">
                      <span>{deleteBtn}</span>
                    </Tooltip>
                  ) : (
                    <Popconfirm title="Delete this workflow?" onConfirm={() => remove(record.id)}>
                      {deleteBtn}
                    </Popconfirm>
                  )}
                </Space>
              );
            },
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
      <HistoryModal
        workflowId={historyFor}
        visible={historyFor !== null}
        onClose={() => setHistoryFor(null)}
      />
    </div>
  );
}
