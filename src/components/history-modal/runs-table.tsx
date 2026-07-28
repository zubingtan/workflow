import type { TagColor } from '@douyinfe/semi-ui/lib/es/tag/interface';
import { Table, Tag, Space, Button, Popconfirm, Tooltip } from '@douyinfe/semi-ui';

import type { RunStatus } from '../../api';

/**
 * Phase 7 (#159): the runs table inside the History Modal.
 *
 * Columns: 提交时间 / 状态 (5 badges) / 排队时长 / 运行耗时 / 操作.
 * Row actions: 查看详情 (all) / 取消运行 (queued|running) / 删除 (terminal).
 */

export interface RunRow {
  id: string;
  status: RunStatus;
  task_id: string | null;
  queued_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}

const STATUS_BADGE: Record<RunStatus, { text: string; color: TagColor; pulse?: boolean }> = {
  queued: { text: '排队中', color: 'grey' },
  running: { text: '运行中', color: 'blue', pulse: true },
  succeeded: { text: '成功', color: 'green' },
  failed: { text: '失败', color: 'red' },
  terminated: { text: '已取消', color: 'orange' },
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
          title: '提交时间',
          dataIndex: 'queued_at',
          render: (v: string | null) => formatTime(v),
        },
        {
          title: '状态',
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
          title: '排队时长',
          key: 'queue_duration',
          render: (_, row: RunRow) => formatDuration(row.queued_at, row.started_at),
        },
        {
          title: '运行耗时',
          key: 'run_duration',
          render: (_, row: RunRow) => formatDuration(row.started_at, row.ended_at),
        },
        {
          title: '操作',
          key: 'actions',
          render: (_, row: RunRow) => {
            const isActive = row.status === 'queued' || row.status === 'running';
            const isTerminal =
              row.status === 'succeeded' || row.status === 'failed' || row.status === 'terminated';
            return (
              <Space>
                <Button size="small" onClick={() => onViewDetail(row.id)}>
                  查看详情
                </Button>
                {isActive && (
                  <Popconfirm title="确认取消该运行？" onConfirm={() => onCancelRun(row.id)}>
                    <Button size="small" type="danger" theme="light">
                      取消运行
                    </Button>
                  </Popconfirm>
                )}
                {isTerminal ? (
                  <Popconfirm title="删除该运行记录？" onConfirm={() => onDeleteRun(row.id)}>
                    <Button size="small" type="danger">
                      删除
                    </Button>
                  </Popconfirm>
                ) : (
                  <Tooltip content="运行结束后可删除">
                    <span>
                      <Button size="small" disabled>
                        删除
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
