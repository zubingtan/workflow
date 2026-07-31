import { useState, useEffect } from 'react';

import { Table, Tag, Button, Empty, Popconfirm, Toast } from '@douyinfe/semi-ui';

import * as api from '../../../api';
import type { AgentDef, AgentExecution } from '../../../api';

interface Props {
  agent: AgentDef;
  onSelectExecution?: (execId: string | null) => void;
}

const STATUS_COLOR: Record<string, 'green' | 'red' | 'grey'> = {
  succeeded: 'green',
  failed: 'red',
  cancelled: 'grey',
};

export function SessionsSection({ agent, onSelectExecution }: Props) {
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const load = () => {
    setLoading(true);
    api
      .listExecutions(agent.id, {
        status: statusFilter || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      })
      .then(setExecutions)
      .catch(() => Toast.error('Failed to load executions'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [agent.id, statusFilter, page, pageSize]);

  const handleDelete = async (execId: string) => {
    try {
      await api.deleteExecution(agent.id, execId);
      load();
    } catch {
      Toast.error('Failed to delete');
    }
  };

  const columns = [
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => <Tag color={STATUS_COLOR[s] || 'grey'}>{s}</Tag>,
    },
    { title: 'Trigger', dataIndex: 'trigger_type', width: 120 },
    {
      title: 'Started',
      dataIndex: 'started_at',
      width: 180,
      render: (t: string) => (t ? new Date(t).toLocaleString() : '-'),
    },
    {
      title: 'Duration',
      width: 100,
      render: (_: any, row: AgentExecution) => {
        if (!row.ended_at) return '-';
        const ms = new Date(row.ended_at).getTime() - new Date(row.started_at).getTime();
        return `${(ms / 1000).toFixed(1)}s`;
      },
    },
    {
      title: '',
      width: 60,
      render: (_: any, row: AgentExecution) => (
        <Popconfirm title="Delete this execution record?" onConfirm={() => handleDelete(row.id)}>
          <Button type="danger" theme="borderless" size="small">
            Del
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>Sessions</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            size="small"
            theme={statusFilter === null ? 'solid' : 'light'}
            onClick={() => setStatusFilter(null)}
          >
            All
          </Button>
          <Button
            size="small"
            theme={statusFilter === 'succeeded' ? 'solid' : 'light'}
            onClick={() => setStatusFilter('succeeded')}
          >
            Succeeded
          </Button>
          <Button
            size="small"
            theme={statusFilter === 'failed' ? 'solid' : 'light'}
            onClick={() => setStatusFilter('failed')}
          >
            Failed
          </Button>
        </div>
      </div>
      {executions.length === 0 && !loading ? (
        <Empty description="No execution history" />
      ) : (
        <Table
          columns={columns}
          dataSource={executions}
          loading={loading}
          rowKey="id"
          pagination={{
            currentPage: page,
            pageSize,
            total: -1,
            onPageChange: setPage,
            onPageSizeChange: setPageSize,
            showSizeChanger: true,
            pageSizeOpts: [10, 20, 50],
          }}
          size="small"
          onRow={(row) => ({
            onClick: () => row && onSelectExecution?.(row.id),
            style: { cursor: 'pointer' },
          })}
        />
      )}
    </div>
  );
}
