import { useState, useEffect } from 'react';

import { Spin, Empty, Typography, Tag, Button } from '../../ui/management';
import * as api from '../../../api';
import type { AgentDef, Mem0Memory } from '../../../api';

interface Props {
  agent: AgentDef;
}

/**
 * Memories section — shows the memories mem0 has stored for this agent.
 *
 * Data comes from the mem0 server via the backend proxy (the browser never
 * holds the mem0 API key). When mem0 is not configured, shows an Empty state.
 */
export function MemoriesSection({ agent }: Props) {
  const [memories, setMemories] = useState<Mem0Memory[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .getAgentMemories(agent.id)
      .then((res) => {
        if (!res.ok) {
          setMemories([]);
          setError(res.error ?? `mem0 returned HTTP ${res.status}`);
          return;
        }
        setMemories(res.results ?? []);
      })
      .catch((err: any) => {
        setMemories([]);
        setError(err?.message ?? 'Failed to load memories');
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [agent.id]);

  if (loading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Memories</h3>
        {memories !== null && memories.length > 0 && (
          <Tag color="blue">{memories.length} stored</Tag>
        )}
        <Button size="small" onClick={load} style={{ marginLeft: 'auto' }}>
          Refresh
        </Button>
      </div>

      {error && (
        <Typography.Paragraph type="danger" style={{ marginBottom: 12 }}>
          {error} — check the mem0 connection in Global Settings.
        </Typography.Paragraph>
      )}

      {!error && (!memories || memories.length === 0) && (
        <Empty description="No memories stored for this agent yet. Run the agent with memory enabled to start capturing." />
      )}

      {memories && memories.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {memories.map((m) => (
            <div
              key={m.id}
              style={{
                padding: 12,
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--background)',
              }}
            >
              <Typography.Text>{m.memory}</Typography.Text>
              <div style={{ marginTop: 6 }}>
                {m.created_at && (
                  <Typography.Text type="tertiary" size="small">
                    {new Date(m.created_at).toLocaleString()}
                  </Typography.Text>
                )}
                {m.updated_at && m.updated_at !== m.created_at && (
                  <Typography.Text type="tertiary" size="small" style={{ marginLeft: 12 }}>
                    updated {new Date(m.updated_at).toLocaleString()}
                  </Typography.Text>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
