import { useCallback, useEffect, useRef, useState } from 'react';

import { IReport } from '@flowgram.ai/runtime-interface';
import { Spin, Button, Typography, Empty } from '@douyinfe/semi-ui';
import { IconArrowLeft } from '@douyinfe/semi-icons';

import { workflowRunEventHub } from '../../workflow-run-event-hub.mjs';
import { FlowDocumentJSON } from '../../typings';
import { Editor } from '../../editor';
import * as api from '../../api';

/**
 * #181: full-screen overlay readonly editor rendering a run. Unified component
 * handling both live-running and terminal states.
 *
 * Mode detection is automatic via `detail.status`:
 *   - queued / running → live mode: fetch workflow `data` for schema, pass
 *     `onLiveTerminal` to the Editor so the LiveHistoryRuntimeService can
 *     notify this component when run_terminal arrives through the shared hub.
 *   - succeeded / failed / terminated → static mode (Phase 8 #160 behavior):
 *     use `schema_snapshot` + `report` from getRun.
 *
 * #182: the live → terminal transition is handled by the
 * LiveHistoryRuntimeService's `onTerminal` callback (passed down via
 * `useEditorProps` → `createLiveHistoryRuntimePlugin`). The service is a
 * subscriber of the shared page-level hub, so this component opens no SSE
 * connection of its own.
 *
 * A top bar with a Back button restores the History Modal (Phase 7 preserves
 * its scroll position because the Modal stays mounted underneath the overlay).
 *
 * The overlay is `position: fixed` at z-index above the Semi Modal (which is
 * ~1000 by default). Semi Modals render at z-index 1000+; we use 1100.
 */
export function ReadonlyViewer({
  runID,
  onClose,
  workflowDeleted: initialWorkflowDeleted = false,
}: {
  runID: string;
  onClose: () => void;
  workflowDeleted?: boolean;
}) {
  const [detail, setDetail] = useState<api.RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflowDeleted, setWorkflowDeleted] = useState(initialWorkflowDeleted);
  const workflowDeletedRef = useRef(initialWorkflowDeleted);
  // #181: live mode needs the workflow's current data as schema (schema_snapshot
  // is NULL until terminal). Fetched once when we detect non-terminal status.
  const [liveSchema, setLiveSchema] = useState<FlowDocumentJSON | null>(null);
  // Force remount when transitioning live → terminal so the Editor swaps
  // runtime plugins (LiveHistoryRuntimeService → StaticHistoryRuntimeService).
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    workflowDeletedRef.current = initialWorkflowDeleted;
    setWorkflowDeleted(initialWorkflowDeleted);
    setLoading(true);
    setError(null);
    setLiveSchema(null);
    setDetail(null);
    setMountKey((k) => k + 1);
    api
      .getRun(runID)
      .then(async (d) => {
        if (cancelled || workflowDeletedRef.current) return;
        setDetail(d);
        // If non-terminal, fetch the workflow's current schema for live canvas.
        if (d.status === 'queued' || d.status === 'running') {
          const wf = await api.getWorkflow(d.workflow_id);
          if (cancelled || workflowDeletedRef.current) return;
          setLiveSchema(typeof wf.data === 'string' ? JSON.parse(wf.data) : wf.data);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load run');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runID]);

  useEffect(() => {
    if (!initialWorkflowDeleted) return;
    workflowDeletedRef.current = true;
    setWorkflowDeleted(true);
  }, [initialWorkflowDeleted]);

  useEffect(() => {
    if (!detail?.workflow_id) return undefined;
    return workflowRunEventHub.subscribe(detail.workflow_id, {
      runID,
      types: ['workflow_deleted'],
      onEvent: (payload: any) => {
        if (payload?.type !== 'workflow_deleted' || payload.workflowId !== detail.workflow_id)
          return;
        workflowDeletedRef.current = true;
        setWorkflowDeleted(true);
      },
    });
  }, [detail?.workflow_id, runID]);

  // #182: handle live → terminal transition. The LiveHistoryRuntimeService
  // (mounted inside the Editor) subscribes to SSE and invokes this callback
  // when it receives a run_terminal event for our runID. We refetch the run
  // detail to pick up the terminal schema_snapshot + report, then remount the
  // Editor in static mode (key change forces clean unmount of the live runtime
  // service + its hub subscription).
  const handleLiveTerminal = useCallback(() => {
    if (workflowDeletedRef.current) return;
    api
      .getRun(runID)
      .then((d) => {
        if (workflowDeletedRef.current) return;
        setDetail(d);
        setMountKey((k) => k + 1); // forces Editor remount → static plugin
      })
      .catch(() => {
        /* keep current state on refetch error */
      });
  }, [runID]);

  const isTerminal =
    detail?.status === 'succeeded' ||
    detail?.status === 'failed' ||
    detail?.status === 'terminated';
  const staticSchema = detail?.schema_snapshot as FlowDocumentJSON | null | undefined;
  const staticReport = detail?.report as IReport | null | undefined;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        background: 'var(--semi-color-bg-0)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '8px 16px',
          borderBottom: '1px solid var(--semi-color-border)',
          flexShrink: 0,
        }}
      >
        <Button icon={<IconArrowLeft />} theme="borderless" onClick={onClose}>
          Back
        </Button>
        <Typography.Text strong>Run Detail — {runID}</Typography.Text>
        {workflowDeleted && (
          <Typography.Text type="danger">Workflow 已删除，当前内容为只读快照</Typography.Text>
        )}
        {detail && (
          <Typography.Text type="tertiary" size="small">
            Status: {detail.status}
          </Typography.Text>
        )}
        {/* #181: Cancel button — only visible while the run is actively running. */}
        {detail && (detail.status === 'queued' || detail.status === 'running') && (
          <Button
            theme="borderless"
            type="danger"
            disabled={workflowDeleted}
            onClick={() => {
              api.cancelRun(runID).catch(() => {
                /* keep current state on cancel error */
              });
            }}
          >
            Cancel Run
          </Button>
        )}
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : error ? (
          <Empty description={error} style={{ padding: 48 }} />
        ) : isTerminal ? (
          staticSchema && staticReport ? (
            <Editor
              key={`static-${mountKey}`}
              data={staticSchema}
              historyReport={staticReport}
              historyRunID={runID}
              workflowId={detail!.workflow_id}
            />
          ) : (
            <Empty description="Terminal data missing" style={{ padding: 48 }} />
          )
        ) : liveSchema ? (
          <Editor
            key={`live-${mountKey}`}
            data={liveSchema}
            liveRunID={runID}
            liveWorkflowId={detail!.workflow_id}
            onLiveTerminal={handleLiveTerminal}
          />
        ) : (
          <Empty description="Loading run..." style={{ padding: 48 }} />
        )}
      </div>
    </div>
  );
}

/**
 * Backwards-compat re-export so any external callers still importing
 * `HistoryViewer` keep working. New code should import `ReadonlyViewer`.
 */
export const HistoryViewer = ReadonlyViewer;
