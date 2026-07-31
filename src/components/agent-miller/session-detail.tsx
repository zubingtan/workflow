import { useState, useEffect } from 'react';

import { Button, Empty, Spin, Tag, Toast, Modal, TextArea } from '@douyinfe/semi-ui';
import { IconClose, IconPlay } from '@douyinfe/semi-icons';

import * as api from '../../api';
import type { AgentDef, AgentExecutionDetail } from '../../api';

interface Props {
  agent: AgentDef;
  executionId: string;
  onClose: () => void;
  onRerun?: (prompt: string) => void;
}

type TagColor =
  | 'blue'
  | 'green'
  | 'grey'
  | 'red'
  | 'orange'
  | 'cyan'
  | 'purple'
  | 'pink'
  | 'violet'
  | 'white'
  | 'yellow';
const ROLE_COLOR: Record<string, TagColor> = {
  user: 'blue',
  assistant: 'green',
  system: 'grey',
};

export function SessionDetailPanel({ agent, executionId, onClose, onRerun }: Props) {
  const [detail, setDetail] = useState<AgentExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunVisible, setRerunVisible] = useState(false);
  const [rerunPrompt, setRerunPrompt] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .getExecutionDetail(agent.id, executionId)
      .then((d) => {
        setDetail(d);
        if (d.sessionDetail?.prompt) setRerunPrompt(d.sessionDetail.prompt);
      })
      .catch(() => Toast.error('Failed to load session detail'))
      .finally(() => setLoading(false));
  }, [agent.id, executionId]);

  const handleRerun = () => {
    if (!rerunPrompt.trim()) return;
    onRerun?.(rerunPrompt);
    setRerunVisible(false);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  if (!detail) {
    return <Empty description="Execution not found" />;
  }

  const messages = detail.sessionDetail?.messages ?? [];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--semi-color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tag
            color={
              detail.status === 'succeeded' ? 'green' : detail.status === 'failed' ? 'red' : 'grey'
            }
          >
            {detail.status}
          </Tag>
          <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            {new Date(detail.started_at).toLocaleString()}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <Button
            size="small"
            icon={<IconPlay />}
            onClick={() => setRerunVisible(true)}
            disabled={!detail.sessionDetail?.prompt}
          >
            Re-run
          </Button>
          <Button size="small" theme="borderless" icon={<IconClose />} onClick={onClose} />
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, minHeight: 0 }}>
        {messages.length === 0 ? (
          <Empty description="No session messages (session file may be unavailable)" />
        ) : (
          messages.map((msg, i: number) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ marginBottom: 4 }}>
                <Tag size="small" color={ROLE_COLOR[msg.role] || ('grey' as TagColor)}>
                  {msg.role}
                </Tag>
                {msg.timestamp && (
                  <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)', marginLeft: 8 }}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--semi-color-fill-0)',
                  borderRadius: 6,
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 300,
                  overflowY: 'auto',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Re-run modal */}
      <Modal
        title="Re-run Agent"
        visible={rerunVisible}
        onOk={handleRerun}
        onCancel={() => setRerunVisible(false)}
        okText="Run"
        width={600}
      >
        <p style={{ marginBottom: 8, color: 'var(--semi-color-text-1)' }}>
          Edit the prompt and re-run with the agent's current configuration:
        </p>
        <TextArea
          autosize={{ minRows: 4, maxRows: 12 }}
          value={rerunPrompt}
          onChange={setRerunPrompt}
        />
      </Modal>
    </div>
  );
}
