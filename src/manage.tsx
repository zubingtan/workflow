import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ArrowRight as IconArrowRight,
  Copy as IconCopy,
  Trash2 as IconDelete,
  Plus as IconPlus,
  History as IconHistory,
} from 'lucide-react';

import { workflowRunEventHub } from './workflow-run-event-hub.mjs';
import { useActiveRunCounts } from './use-active-run-counts';
import { newWorkflowTemplate } from './new-workflow-template.mjs';
import {
  Button,
  Modal,
  Input,
  Typography,
  Popconfirm,
  Toast,
  Tooltip,
} from './components/ui/management';
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
      .catch((err) => {
        if (generation === reloadGeneration.current) {
          Toast.error(err instanceof Error ? err.message : 'Failed to load workflows');
        }
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
    try {
      await api.copyWorkflow(id);
      reload();
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : 'Failed to copy workflow');
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    try {
      const wf = await api.createWorkflow(newName.trim(), newWorkflowTemplate());
      setCreating(false);
      setNewName('');
      onOpen(wf.id);
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : 'Failed to create workflow');
    }
  };

  return (
    <div
      style={{
        minHeight: '100%',
        maxWidth: 1120,
        margin: '0 auto',
        padding: '28px 24px 40px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 20,
          marginBottom: 24,
        }}
      >
        <div>
          <Typography.Title heading={3} style={{ margin: 0 }}>
            Workflows
          </Typography.Title>
          <Typography.Paragraph type="tertiary" style={{ margin: '6px 0 0' }}>
            Build, test and monitor reusable agent workflows.
          </Typography.Paragraph>
        </div>
        <Button icon={<IconPlus />} theme="solid" onClick={() => setCreating(true)}>
          New workflow
        </Button>
      </div>

      <div
        aria-label="Workflow list"
        style={{
          overflow: 'hidden',
          border: '1px solid var(--border)',
          borderRadius: 14,
          background: 'var(--card)',
        }}
      >
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Typography.Text type="tertiary">Loading workflows…</Typography.Text>
          </div>
        ) : workflows.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Typography.Text type="tertiary">No workflows yet.</Typography.Text>
          </div>
        ) : (
          workflows.map((record) => {
            const active = activeCounts[record.id] ?? 0;
            const deleteDisabled = active > 0;
            const updated = new Date(record.updated_at).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
            const deleteBtn = (
              <Button
                size="small"
                type="danger"
                icon={<IconDelete />}
                disabled={deleteDisabled}
                aria-label={`Delete ${record.name}`}
              />
            );
            return (
              <div
                key={record.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  minHeight: 84,
                  padding: '14px 16px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    flexShrink: 0,
                    borderRadius: '50%',
                    background: 'var(--app-color-primary)',
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Button
                    theme="borderless"
                    onClick={() => onOpen(record.id)}
                    style={{
                      height: 'auto',
                      padding: 0,
                      fontWeight: 600,
                      color: 'var(--foreground)',
                    }}
                  >
                    {record.name}
                  </Button>
                  <Typography.Text
                    type="tertiary"
                    size="small"
                    style={{ display: 'block', marginTop: 5 }}
                  >
                    Draft · Updated {updated}
                  </Typography.Text>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: 999,
                      padding: '3px 8px',
                      color: 'var(--muted-foreground)',
                      fontSize: 12,
                    }}
                  >
                    {active > 0 ? `${active} active` : 'Ready'}
                  </span>
                  <Button size="small" onClick={() => onOpen(record.id)}>
                    Open <IconArrowRight />
                  </Button>
                  <Button
                    size="small"
                    icon={<IconCopy />}
                    onClick={() => copy(record.id)}
                    aria-label={`Copy ${record.name}`}
                  />
                  <Button
                    size="small"
                    icon={<IconHistory />}
                    onClick={() => setHistoryFor(record.id)}
                    aria-label={`History for ${record.name}`}
                  />
                  {deleteDisabled ? (
                    <Tooltip content="This workflow has running or queued runs — cancel them first">
                      <span>{deleteBtn}</span>
                    </Tooltip>
                  ) : (
                    <Popconfirm title="Delete this workflow?" onConfirm={() => remove(record.id)}>
                      {deleteBtn}
                    </Popconfirm>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
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
