import { useEffect, useState } from 'react';

import { IReport } from '@flowgram.ai/runtime-interface';
import { Spin, Button, Typography, Empty } from '@douyinfe/semi-ui';
import { IconArrowLeft } from '@douyinfe/semi-icons';

import { FlowDocumentJSON } from '../../typings';
import { Editor } from '../../editor';
import * as api from '../../api';

/**
 * Phase 8 (#160): full-screen overlay readonly editor rendering a historical
 * run's terminal snapshot.
 *
 * Flow:
 *   1. `getRun(runID)` → `{ schema_snapshot, report, status, ... }`.
 *   2. If `status` is non-terminal (user opened detail while still running)
 *      and there's no `schema_snapshot`/`report` yet, show a placeholder
 *      ("运行中，完成后请重新打开").
 *   3. Otherwise render `<Editor>` with:
 *        - `data` = `schema_snapshot` (the workflow layout at terminal time)
 *        - `historyReport` = the parsed `report` (IReport)
 *        - `historyRunID` = runID
 *      The Editor switches to readonly + StaticHistoryRuntimeService.
 *
 * No `DemoTools` toolbar is mounted — the history view has no edit affordances.
 * A top bar with a 返回 button restores the History Modal (Phase 7 preserves
 * its scroll position because the Modal stays mounted underneath the overlay).
 *
 * The overlay is `position: fixed` at z-index above the Semi Modal (which is
 * ~1000 by default). Semi Modals render at z-index 1000+; we use 1100.
 */
export function HistoryViewer({ runID, onClose }: { runID: string; onClose: () => void }) {
  const [detail, setDetail] = useState<api.RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getRun(runID)
      .then((d) => {
        if (!cancelled) setDetail(d);
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

  const isTerminal =
    detail?.status === 'succeeded' ||
    detail?.status === 'failed' ||
    detail?.status === 'terminated';
  const schema = detail?.schema_snapshot as FlowDocumentJSON | null | undefined;
  const report = detail?.report as IReport | null | undefined;

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
      </div>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : error ? (
          <Empty description={error} style={{ padding: 48 }} />
        ) : !isTerminal || !schema || !report ? (
          // Non-terminal or missing snapshot — the run hasn't captured a
          // terminal report yet. Per spec: show a placeholder.
          <Empty description="运行中，完成后请重新打开" style={{ padding: 48 }} />
        ) : (
          <Editor
            data={schema}
            historyReport={report}
            historyRunID={runID}
            workflowId={detail.workflow_id}
          />
        )}
      </div>
    </div>
  );
}
