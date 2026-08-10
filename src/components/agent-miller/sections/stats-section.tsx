import { useState, useEffect } from 'react';

import { Card, Spin, Empty, Toast, Typography } from '../../ui/management';
import * as api from '../../../api';
import type { AgentDef, AgentStats } from '../../../api';

interface Props {
  agent: AgentDef;
}

export function StatsSection({ agent }: Props) {
  const [stats, setStats] = useState<AgentStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getAgentStats(agent.id)
      .then(setStats)
      .catch(() => Toast.error('Failed to load stats'))
      .finally(() => setLoading(false));
  }, [agent.id]);

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;
  if (!stats || stats.overview.totalExecutions === 0)
    return <Empty description="No execution data yet" />;

  const { overview, daily } = stats;

  return (
    <div>
      <h3 style={{ marginBottom: 16 }}>Statistics</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <Card shadows="hover" style={{ padding: 12, textAlign: 'center' }}>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {overview.totalExecutions}
          </Typography.Title>
          <Typography.Text type="tertiary">Total Runs</Typography.Text>
        </Card>
        <Card shadows="hover" style={{ padding: 12, textAlign: 'center' }}>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {(overview.successRate * 100).toFixed(0)}%
          </Typography.Title>
          <Typography.Text type="tertiary">Success Rate</Typography.Text>
        </Card>
        <Card shadows="hover" style={{ padding: 12, textAlign: 'center' }}>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {(overview.avgDurationMs / 1000).toFixed(1)}s
          </Typography.Title>
          <Typography.Text type="tertiary">Avg Duration</Typography.Text>
        </Card>
      </div>

      <h4 style={{ marginBottom: 8 }}>Last 30 Days</h4>
      {daily.length === 0 ? (
        <Empty description="No recent activity" />
      ) : (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
          {daily.map((d) => (
            <div
              key={d.date}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}
              title={`${d.date}: ${d.count} runs`}
            >
              <div
                style={{
                  width: '100%',
                  maxWidth: 20,
                  height: `${Math.max(
                    4,
                    (d.count / Math.max(...daily.map((x) => x.count))) * 60
                  )}px`,
                  background: d.failed > 0 ? 'var(--destructive)' : 'var(--primary)',
                  borderRadius: 2,
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
