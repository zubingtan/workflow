import { Table, Tag, Space, Button, Popconfirm, Tooltip } from '@douyinfe/semi-ui';

import type { RunMeta, RunStatus } from '../../api';

/**
 * Phase 7 (#159): the runs table inside the History Modal.
 *
 * Columns: Submitted / Status (5 badges) / Queue Time / Run Time / Actions.
 * Row actions: View Detail (all) / Cancel Run (queued|running) / Delete (terminal).
 */

// The table row shape is exactly the REST list payload (RunMeta).
export type RunRow = RunMeta;

// Semi's Tag `color` prop accepts a fixed union; we mirror the relevant subset
// here rather than reaching into the package's deep `lib/es/...` path (which
// the Semi BEST_PRACTICES guide warns is fragile across version bumps).
type TagColor =
  | 'amber'
  | 'blue'
  | 'cyan'
  | 'green'
  | 'grey'
  | 'indigo'
  | 'light-blue'
  | 'light-green'
  | 'lime'
  | 'orange'
  | 'pink'
  | 'purple'
  | 'red'
  | 'teal'
  | 'violet'
  | 'yellow'
  | 'white';

const STATUS_BADGE: Record<RunStatus, { text: string; color: TagColor; pulse?: boolean }> = {
  queued: { text: 'Queued', color: 'grey' },
  running: { text: 'Running', color: 'blue', pulse: true },
  succeeded: { text: 'Succeeded', color: 'green' },
  failed: { text: 'Failed', color: 'red' },
  terminated: { text: 'Cancelled', color: 'orange' },
};

function formatTime(ts: string | null): string {
  if (!ts) return '—';
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" UTC. Render as-is
  // for now; a proper timezone-aware formatter is out of scope for Phase 7.
  return ts.replace('T', ' ');
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  const ms = Date.parse(end.replace(' ', 'T') + 'Z') - Date.parse(start.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function RunsTable({
  rows,
  onViewDetail,
  onCancelRun,
  onDeleteRun,
}: {
  rows: RunRow[];
  onViewDetail: (runID: string) => void;
  onCancelRun: (runID: string) => void;
  onDeleteRun: (runID: string) => void;
}) {
  return (
    <Table
      dataSource={rows}
      rowKey="id"
      pagination={false}
      columns={[
        {
          title: 'Submitted',
          dataIndex: 'queued_at',
          render: (v: string | null) => formatTime(v),
        },
        {
          title: 'Status',
          dataIndex: 'status',
          render: (status: RunStatus) => {
            const badge = STATUS_BADGE[status] ?? { text: status, color: 'grey' };
            return (
              <Tag
                color={badge.color}
                size="large"
                style={
                  badge.pulse ? { animation: 'semi-pulse 1.5s ease-in-out infinite' } : undefined
                }
              >
                {badge.text}
              </Tag>
            );
          },
        },
        {
          title: 'Queue Time',
          key: 'queue_duration',
          render: (_, row: RunRow) => formatDuration(row.queued_at, row.started_at),
        },
        {
          title: 'Run Time',
          key: 'run_duration',
          render: (_, row: RunRow) => formatDuration(row.started_at, row.ended_at),
        },
        {
          title: 'Actions',
          key: 'actions',
          render: (_, row: RunRow) => {
            const isActive = row.status === 'queued' || row.status === 'running';
            const isTerminal =
              row.status === 'succeeded' || row.status === 'failed' || row.status === 'terminated';
            return (
              <Space>
                <Button size="small" onClick={() => onViewDetail(row.id)}>
                  View Detail
                </Button>
                {isActive && (
                  <Popconfirm title="Cancel this run?" onConfirm={() => onCancelRun(row.id)}>
                    <Button size="small" type="danger" theme="light">
                      Cancel Run
                    </Button>
                  </Popconfirm>
                )}
                {isTerminal ? (
                  <Popconfirm title="Delete this run record?" onConfirm={() => onDeleteRun(row.id)}>
                    <Button size="small" type="danger">
                      Delete
                    </Button>
                  </Popconfirm>
                ) : (
                  <Tooltip content="Available after the run finishes">
                    <span>
                      <Button size="small" disabled>
                        Delete
                      </Button>
                    </span>
                  </Tooltip>
                )}
              </Space>
            );
          },
        },
      ]}
    />
  );
}
