import { useEffect, useRef, useState } from 'react';

import { Modal, Toast, Empty, Spin } from '@douyinfe/semi-ui';

import * as api from '../../api';
import { RunsTable, type RunRow } from './runs-table';
import { HistoryViewer } from '../history-viewer';

/**
 * Phase 7 (#159): central History Modal for a workflow.
 *
 * On `visible`:
 *   - REST pull via `listRuns(workflowId)` → initial rows (no heavy columns).
 *   - Open `EventSource('/api/workflows/:id/runs/events')` (Phase 5) for
 *     incremental updates: `run_status` patches the matching row (or inserts
 *     if new); `run_terminal` replaces the row with the terminal payload;
 *     `workflow_deleted` closes the Modal.
 * On `onClose` / unmount: close the EventSource.
 *
 * The detail viewer (HistoryViewer) is Phase 8 — for now the 查看详情 action
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
  // Keep onClose in a ref so the SSE effect doesn't tear down/recreate the
  // EventSource when the parent re-renders with a fresh inline onClose arrow.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Patch a run row by id; if missing and `insert` is true, prepend a new row
  // (used when an SSE event arrives for a run not yet in the REST list).
  const patchRow = (runID: string, patch: Partial<RunRow>, insert = false) => {
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
    setLoading(true);
    setRows([]);
    api
      .listRuns(workflowId)
      .then((list) => {
        setRows(list.map((r) => ({ ...r })));
      })
      .catch((err) => {
        Toast.error(err instanceof Error ? err.message : 'Failed to load history');
      })
      .finally(() => setLoading(false));
  }, [visible, workflowId]);

  // SSE incremental updates while visible. One EventSource per open Modal —
  // the manager's useActiveRunCounts subscription drops this workflowId while
  // the Modal is open (§5 coordination: only one EventSource per workflow).
  useEffect(() => {
    if (!visible || !workflowId) return;
    const url = `${api.SERVER_URL}/api/workflows/${workflowId}/runs/events`;
    const es = new EventSource(url);

    es.onmessage = (ev) => {
      let payload: any;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!payload || typeof payload !== 'object') return;
      const { type, runID, status, queued_at, started_at, ended_at, workflowId: evtWfId } = payload;
      if (type === 'workflow_deleted') {
        // Only close if the deleted workflow is the one this Modal is showing.
        if (evtWfId !== workflowId) return;
        es.close();
        onCloseRef.current();
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
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };

    return () => {
      es.close();
    };
  }, [visible, workflowId]);

  const onCancelRun = async (runID: string) => {
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
      title="运行历史"
      visible={visible}
      onCancel={onClose}
      footer={null}
      closeOnEsc
      width="70%"
      style={{ maxWidth: '70vw' }}
    >
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : rows.length === 0 ? (
        <Empty description="暂无运行记录" style={{ padding: 48 }} />
      ) : (
        <RunsTable
          rows={rows}
          onViewDetail={onViewDetail}
          onCancelRun={onCancelRun}
          onDeleteRun={onDeleteRun}
        />
      )}
      {/* Phase 8 (#160): full-screen readonly viewer overlay. Rendered above
          the Modal (z-index 1100 > Modal's 1000). The Modal stays mounted
          underneath so its scroll position is preserved on 返回. */}
      {selectedRunID && (
        <HistoryViewer runID={selectedRunID} onClose={() => setSelectedRunID(null)} />
      )}
    </Modal>
  );
}
