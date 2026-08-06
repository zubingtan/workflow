import { useEffect, useRef, useState } from 'react';

import { Modal, Toast, Empty, Spin, Typography } from '@douyinfe/semi-ui';

import { ReadonlyViewer as HistoryViewer } from '../readonly-viewer';
import { workflowRunEventHub } from '../../workflow-run-event-hub.mjs';
import * as api from '../../api';
import { RunsTable, type RunRow } from './runs-table';

/**
 * Phase 7 (#159): central History Modal for a workflow.
 *
 * On `visible`:
 *   - REST pull via `listRuns(workflowId)` → initial rows (no heavy columns).
 *   - Subscribe to the page-level WorkflowRunEventHub for incremental updates:
 *     `run_status` patches the matching row (or inserts if new),
 *     `run_terminal` replaces the row with the terminal payload, and
 *     `workflow_deleted` keeps the current rows as a readonly snapshot.
 * On `onClose` / unmount: remove this subscriber from the hub.
 *
 * The detail viewer (HistoryViewer) is Phase 8 — for now the View Detail action
 * is hidden behind a TODO that Phase 8 will wire. Non-terminal rows show a
 * placeholder until terminal.
 */
export function HistoryModal({
  workflowId,
  visible,
  onClose,
}: {
  workflowId: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Phase 8 (#160): the readonly HistoryViewer overlay for a selected run.
  const [selectedRunID, setSelectedRunID] = useState<string | null>(null);
  const [workflowDeleted, setWorkflowDeleted] = useState(false);
  const workflowDeletedRef = useRef(false);

  // Patch a run row by id; if missing and `insert` is true, prepend a new row
  // (used when an SSE event arrives for a run not yet in the REST list).
  const patchRow = (runID: string, patch: Partial<RunRow>, insert = false) => {
    if (workflowDeletedRef.current) return;
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === runID);
      if (idx === -1) {
        if (!insert) return prev;
        // New run appeared via SSE before the REST list surfaced it — insert
        // at the top (newest by queued_at).
        return [{ id: runID, status: 'queued', ...patch } as RunRow, ...prev];
      }
      const next = prev.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  // REST pull on open.
  useEffect(() => {
    if (!visible || !workflowId) return;
    let cancelled = false;
    workflowDeletedRef.current = false;
    setWorkflowDeleted(false);
    setLoading(true);
    setRows([]);
    api
      .listRuns(workflowId)
      .then((list) => {
        if (cancelled || workflowDeletedRef.current) return;
        setRows(list.map((r) => ({ ...r })));
      })
      .catch((err) => {
        Toast.error(err instanceof Error ? err.message : 'Failed to load history');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, workflowId]);

  // SSE incremental updates while visible. The hub keeps this subscriber,
  // the manager count subscriber and any live viewer on one EventSource.
  useEffect(() => {
    if (!visible || !workflowId) return;
    return workflowRunEventHub.subscribe(workflowId, {
      onEvent: (payload: any) => {
        if (!payload || typeof payload !== 'object') return;
        const {
          type,
          runID,
          status,
          queued_at,
          started_at,
          ended_at,
          workflowId: evtWfId,
        } = payload;
        if (type === 'workflow_deleted') {
          if (evtWfId !== workflowId) return;
          workflowDeletedRef.current = true;
          setWorkflowDeleted(true);
          return;
        }
        if (workflowDeletedRef.current) return;
        if (type === 'snapshot' && Array.isArray(payload.runs)) {
          setRows(payload.runs.map((run: RunRow) => ({ ...run })));
          return;
        }
        if (!runID) return;
        if (type === 'run_status') {
          patchRow(
            runID,
            {
              status,
              ...(queued_at !== undefined ? { queued_at } : {}),
              ...(started_at !== undefined ? { started_at } : {}),
            },
            true
          );
        } else if (type === 'run_terminal') {
          // Terminal capture carries the full report + schema_snapshot + ended_at.
          // We keep only the row-level fields here (report/schema_snapshot are
          // fetched on demand by the detail viewer in Phase 8).
          patchRow(runID, {
            status,
            ended_at,
            ...(started_at !== undefined ? { started_at } : {}),
          });
        }
      },
    });
  }, [visible, workflowId]);

  const onCancelRun = async (runID: string) => {
    if (workflowDeletedRef.current) return;
    try {
      await api.cancelRun(runID);
      // Optimistic: mark terminated. The SSE stream will confirm; if the
      // server refuses (e.g. already terminal), the next REST pull reconciles.
      patchRow(runID, { status: 'terminated' });
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : 'Failed to cancel run');
    }
  };

  const onDeleteRun = async (runID: string) => {
    if (workflowDeletedRef.current) return;
    try {
      await api.deleteRun(runID);
      setRows((prev) => prev.filter((r) => r.id !== runID));
    } catch (err) {
      Toast.error(err instanceof Error ? err.message : 'Failed to delete run');
    }
  };

  const onViewDetail = (runID: string) => {
    // Phase 8 (#160): open the full-screen readonly editor overlay.
    setSelectedRunID(runID);
  };

  return (
    <Modal
      title={workflowDeleted ? 'Run History · Workflow 已删除' : 'Run History'}
      visible={visible}
      onCancel={onClose}
      footer={null}
      closeOnEsc
      width="70%"
      style={{ maxWidth: '70vw' }}
    >
      {workflowDeleted && (
        <Typography.Text type="danger" style={{ display: 'block', marginBottom: 12 }}>
          Workflow 已删除。当前运行记录是只读快照。
        </Typography.Text>
      )}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : rows.length === 0 ? (
        <Empty description="No runs yet" style={{ padding: 48 }} />
      ) : (
        <RunsTable
          rows={rows}
          onViewDetail={onViewDetail}
          onCancelRun={onCancelRun}
          onDeleteRun={onDeleteRun}
          readOnly={workflowDeleted}
        />
      )}
      {/* Phase 8 (#160): full-screen readonly viewer overlay. Rendered above
          the Modal (z-index 1100 > Modal's 1000). The Modal stays mounted
          underneath so its scroll position is preserved on Back. */}
      {selectedRunID && (
        <HistoryViewer
          runID={selectedRunID}
          workflowDeleted={workflowDeleted}
          onClose={() => setSelectedRunID(null)}
        />
      )}
    </Modal>
  );
}
