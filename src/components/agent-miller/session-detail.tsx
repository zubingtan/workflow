import { useState, useEffect, useRef } from 'react';

import { X as IconClose, Play as IconPlay } from 'lucide-react';

import { Button, Empty, Spin, Tag, Toast, Modal, TextArea } from '../ui/management';
import { AgentExecutionPanel } from '../agent-execution';
import * as api from '../../api';
import type { AgentDef, AgentExecutionDetail } from '../../api';
import { useAgentExecution } from '../../agent-execution/use-agent-execution';

interface Props {
  agent: AgentDef;
  executionId: string;
  onClose: () => void;
}

type TagColor = 'blue' | 'green' | 'grey' | 'red' | 'orange';
const ROLE_COLOR: Record<string, TagColor> = {
  user: 'blue',
  assistant: 'green',
  system: 'grey',
};

export function SessionDetailPanel({ agent, executionId, onClose }: Props) {
  const [detail, setDetail] = useState<AgentExecutionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [rerunVisible, setRerunVisible] = useState(false);
  const [rerunPrompt, setRerunPrompt] = useState('');
  const [rerunStarted, setRerunStarted] = useState(false);
  const rerun = useAgentExecution({ agentId: agent.id, prompt: rerunPrompt });
  const cancelRerunRef = useRef(rerun.cancel);
  cancelRerunRef.current = rerun.cancel;

  useEffect(() => {
    let cancelled = false;
    setRerunVisible(false);
    setRerunStarted(false);
    setRerunPrompt('');
    setLoading(true);
    api
      .getExecutionDetail(agent.id, executionId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        if (d.sessionDetail?.prompt) setRerunPrompt(d.sessionDetail.prompt);
      })
      .catch(() => {
        if (!cancelled) Toast.error('Failed to load session detail');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent.id, executionId]);

  // Selecting another execution reuses this inspector component. Stop a
  // previous live rerun before its output can appear under the new session.
  useEffect(
    () => () => {
      cancelRerunRef.current();
    },
    [agent.id, executionId]
  );

  const handleRerun = () => {
    if (!rerunPrompt.trim()) return;
    setRerunVisible(false);
    setRerunStarted(true);
    rerun.run();
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
          borderBottom: '1px solid var(--border)',
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
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
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
                  <span style={{ fontSize: 11, color: 'var(--muted-foreground)', marginLeft: 8 }}>
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <div
                style={{
                  padding: '8px 12px',
                  background: 'var(--muted)',
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
        {rerunStarted && (
          <AgentExecutionPanel
            phase={rerun.phase}
            content={rerun.content}
            toolEvents={rerun.toolEvents}
            error={rerun.error}
            isRunning={rerun.isRunning}
            canRun={Boolean(rerunPrompt.trim())}
            prompt={rerunPrompt}
            onRun={rerun.run}
            onCancel={rerun.cancel}
          />
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
        <p style={{ marginBottom: 8, color: 'var(--foreground)' }}>
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
