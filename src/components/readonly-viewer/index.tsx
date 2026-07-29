import { useEffect, useState } from 'react';

import { IReport } from '@flowgram.ai/runtime-interface';
import { Spin, Button, Typography, Empty } from '@douyinfe/semi-ui';
import { IconArrowLeft } from '@douyinfe/semi-icons';

import { FlowDocumentJSON } from '../../typings';
import { Editor } from '../../editor';
import * as api from '../../api';
import { SERVER_URL } from '../../api';

/**
 * #181: full-screen overlay readonly editor rendering a run. Unified component
 * handling both live-running and terminal states.
 *
 * Mode detection is automatic via `detail.status`:
 *   - queued / running → live mode: fetch workflow `data` for schema, subscribe
 *     SSE for per-node progress, show Cancel button when running.
 *   - succeeded / failed / terminated → static mode (Phase 8 #160 behavior):
 *     use `schema_snapshot` + `report` from getRun.
 *
 * Live → terminal transition: when the SSE stream delivers `run_terminal` for
 * our runID, refetch getRun to pick up the terminal schema_snapshot + report,
 * then remount the Editor in static mode (key change forces clean unmount of
 * the live runtime service + its EventSource).
 *
 * A top bar with a 返回 button restores the History Modal (Phase 7 preserves
 * its scroll position because the Modal stays mounted underneath the overlay).
 *
 * The overlay is `position: fixed` at z-index above the Semi Modal (which is
 * ~1000 by default). Semi Modals render at z-index 1000+; we use 1100.
 */
export function ReadonlyViewer({ runID, onClose }: { runID: string; onClose: () => void }) {
  const [detail, setDetail] = useState<api.RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // #181: live mode needs the workflow's current data as schema (schema_snapshot
  // is NULL until terminal). Fetched once when we detect non-terminal status.
  const [liveSchema, setLiveSchema] = useState<FlowDocumentJSON | null>(null);
  // Force remount when transitioning live → terminal so the Editor swaps
  // runtime plugins (LiveHistoryRuntimeService → StaticHistoryRuntimeService).
  const [mountKey, setMountKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLiveSchema(null);
    setDetail(null);
    setMountKey((k) => k + 1);
    api
      .getRun(runID)
      .then(async (d) => {
        if (cancelled) return;
        setDetail(d);
        // If non-terminal, fetch the workflow's current schema for live canvas.
        if (d.status === 'queued' || d.status === 'running') {
          const wf = await api.getWorkflow(d.workflow_id);
          if (cancelled) return;
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

  // #181: subscribe to SSE for run_terminal transition (live → static).
  useEffect(() => {
    if (
      !detail ||
      detail.status === 'succeeded' ||
      detail.status === 'failed' ||
      detail.status === 'terminated'
    ) {
      return; // Already terminal — no SSE needed.
    }
    const workflowId = detail.workflow_id;
    const url = `${SERVER_URL}/api/workflows/${workflowId}/runs/events`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      let payload: any;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!payload || typeof payload !== 'object') return;
      const { type, runID: evRunID } = payload;
      if (evRunID && evRunID !== runID) return;
      if (type === 'run_terminal') {
        // The run finished. Refetch to pick up terminal schema_snapshot +
        // report, then remount the Editor in static mode.
        api
          .getRun(runID)
          .then((d) => {
            setDetail(d);
            setMountKey((k) => k + 1); // forces Editor remount → static plugin
          })
          .catch(() => {
            /* keep current state on refetch error */
          });
        es.close();
      }
    };
    return () => es.close();
  }, [detail?.status, runID]); // re-run only when status changes

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
          返回
        </Button>
        <Typography.Text strong>运行详情 — {runID}</Typography.Text>
        {detail && (
          <Typography.Text type="tertiary" size="small">
            状态: {detail.status}
          </Typography.Text>
        )}
        {/* #181: Cancel button — only visible while the run is actively running. */}
        {detail && detail.status === 'running' && (
          <Button
            theme="borderless"
            type="danger"
            onClick={() => {
              api.cancelRun(runID).catch(() => {
                /* keep current state on cancel error */
              });
            }}
          >
            取消运行
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
            <Empty description="终态数据缺失" style={{ padding: 48 }} />
          )
        ) : liveSchema ? (
          <Editor
            key={`live-${mountKey}`}
            data={liveSchema}
            liveRunID={runID}
            liveWorkflowId={detail!.workflow_id}
          />
        ) : (
          <Empty description="加载运行中..." style={{ padding: 48 }} />
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
