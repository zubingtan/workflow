import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  Button,
  Table,
  Modal,
  Input,
  Typography,
  Space,
  Popconfirm,
  Toast,
  Tooltip,
} from '@douyinfe/semi-ui';
import { IconCopy, IconDelete, IconPlus, IconHistory } from '@douyinfe/semi-icons';

import { useActiveRunCounts } from './use-active-run-counts';
import { newWorkflowTemplate } from './new-workflow-template.mjs';
import { HistoryModal } from './components/history-modal';
import * as api from './api';
import { ApiError } from './api';

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
        Toast.warning('Cancel running or queued runs before deleting');
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
                    History
                  </Button>
                  {deleteDisabled ? (
                    <Tooltip content="This workflow has running or queued runs — cancel them first">
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
