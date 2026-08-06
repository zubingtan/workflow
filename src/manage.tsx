import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

import { workflowRunEventHub } from './workflow-run-event-hub.mjs';
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
  const reloadGeneration = useRef(0);
  const deletedWorkflowIds = useRef(new Set<string>());

  const reload = useCallback(() => {
    const generation = ++reloadGeneration.current;
    setLoading(true);
    api
      .listWorkflows()
      .then((list) => {
        if (generation !== reloadGeneration.current) return;
        setWorkflows(list.filter((workflow) => !deletedWorkflowIds.current.has(workflow.id)));
      })
      .finally(() => {
        if (generation === reloadGeneration.current) setLoading(false);
      });
  }, []);

  useEffect(() => reload(), [reload]);

  // The manager, History Modal, Test Run and ReadonlyViewer share one
  // page-level WorkflowRunEventHub connection.
  const workflowIds = useMemo(() => workflows.map((w) => w.id), [workflows]);
  const activeCounts = useActiveRunCounts(workflowIds);

  useEffect(() => {
    if (workflowIds.length === 0) return undefined;
    return workflowRunEventHub.subscribeMany(
      workflowIds.map((workflowId) => ({
        workflowId,
        subscription: {
          types: ['workflow_deleted'],
          onEvent: (payload: any) => {
            if (payload?.type !== 'workflow_deleted' || payload.workflowId !== workflowId) return;
            reloadGeneration.current += 1;
            deletedWorkflowIds.current.add(workflowId);
            setWorkflows((current) => current.filter((workflow) => workflow.id !== workflowId));
            setLoading(false);
          },
        },
      }))
    );
  }, [workflowIds]);

  const remove = async (id: string) => {
    try {
      await api.deleteWorkflow(id);
      deletedWorkflowIds.current.add(id);
      setWorkflows((current) => current.filter((workflow) => workflow.id !== id));
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
