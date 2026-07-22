/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useState, useEffect, useRef } from 'react';

import { Button, Empty, TextArea } from '@douyinfe/semi-ui';
import { IconClose, IconChevronLeft, IconSend } from '@douyinfe/semi-icons';

import { sessionManager, consumeLLMStream, type Session } from '../../services';
import { useSessionPanel } from '../../plugins/panel-manager-plugin/hooks';
import { truncateText } from '../../nodes/llm/components/stream-section';

import styles from './session-panel.module.less';

export interface SessionPanelProps {}

const DEFAULT_API_HOST = 'http://localhost:4001';
const DEFAULT_MODEL = 'gpt-3.5-turbo';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const SessionPanel: FC<SessionPanelProps> = () => {
  const { close: closePanel } = useSessionPanel();
  const [sessions, setSessions] = useState<Session[]>(sessionManager.getAll());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [testPrompt, setTestPrompt] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(
    () =>
      sessionManager.subscribe(() => {
        setSessions(sessionManager.getAll());
      }),
    []
  );

  const selectedSession = selectedId ? sessionManager.get(selectedId) : undefined;

  const handleNewTest = async () => {
    if (!testPrompt.trim()) {
      return;
    }

    const messages = [{ role: 'user' as const, content: testPrompt.trim() }];
    const session = sessionManager.create(undefined, 'Panel Test', messages);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setTestPrompt('');

    await consumeLLMStream({
      apiHost: DEFAULT_API_HOST,
      model: DEFAULT_MODEL,
      apiKey: '',
      temperature: 0.5,
      messages,
      sessionId: session.id,
      signal: abortController.signal,
    });

    abortControllerRef.current = null;
  };

  const renderSessionList = () => {
    if (sessions.length === 0) {
      return (
        <div className={styles.sessionPanelContent}>
          <div className={styles.sessionEmpty}>
            <Empty
              title="No sessions"
              description="Click Stream on an LLM node, or send a test prompt below"
            />
          </div>
          <div className={styles.sessionNewTest}>
            <TextArea
              placeholder="Enter a test prompt..."
              value={testPrompt}
              onChange={(value) => setTestPrompt(value)}
              autosize={{ minRows: 2, maxRows: 4 }}
            />
            <Button
              icon={<IconSend size="small" />}
              size="small"
              theme="light"
              type="primary"
              disabled={!testPrompt.trim()}
              onClick={handleNewTest}
              style={{ width: '100%' }}
            >
              Send
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.sessionPanelContent}>
        {sessions.map((session) => (
          <div
            key={session.id}
            className={styles.sessionListItem}
            onClick={() => setSelectedId(session.id)}
          >
            <div className={styles.sessionItemHeader}>
              <span className={styles.sessionItemTitle}>
                {session.nodeTitle || session.nodeId || `Session ${session.id.slice(0, 6)}`}
              </span>
              <span className={`${styles.sessionItemStatus} ${styles[session.status]}`}>
                {session.status}
              </span>
            </div>
            {session.streamingContent && (
              <div className={styles.sessionItemPreview}>
                {truncateText(session.streamingContent, 80)}
              </div>
            )}
            {session.error && (
              <div
                className={styles.sessionItemPreview}
                style={{ color: 'var(--semi-color-danger)' }}
              >
                {truncateText(session.error, 80)}
              </div>
            )}
            <div className={styles.sessionItemTime}>{formatTime(session.createdAt)}</div>
          </div>
        ))}
        <div className={styles.sessionNewTest}>
          <TextArea
            placeholder="Enter a test prompt..."
            value={testPrompt}
            onChange={(value) => setTestPrompt(value)}
            autosize={{ minRows: 2, maxRows: 4 }}
          />
          <Button
            icon={<IconSend size="small" />}
            size="small"
            theme="light"
            type="primary"
            disabled={!testPrompt.trim()}
            onClick={handleNewTest}
            style={{ width: '100%' }}
          >
            Send
          </Button>
        </div>
      </div>
    );
  };

  const renderSessionDetail = () => {
    if (!selectedSession) {
      return null;
    }

    const session = selectedSession;

    return (
      <div className={styles.sessionPanelContent}>
        <Button
          className={styles.sessionBackButton}
          icon={<IconChevronLeft />}
          size="small"
          theme="borderless"
          onClick={() => setSelectedId(null)}
        >
          Back
        </Button>
        <div className={styles.sessionDetail}>
          <div className={styles.sessionDetailSection}>
            <div className={styles.sectionTitle}>Messages</div>
            {session.messages.map((msg, idx) => (
              <div key={idx} className={`${styles.messageBubble} ${styles[msg.role]}`}>
                <div className={styles.messageRole}>{msg.role}</div>
                <div>{msg.content}</div>
              </div>
            ))}
            {session.status === 'streaming' && session.streamingContent && (
              <div className={styles.streamingContent}>
                {session.streamingContent}
                <span style={{ opacity: 0.5 }}>▋</span>
              </div>
            )}
            {session.status === 'streaming' && !session.streamingContent && (
              <div className={styles.streamingContent} style={{ opacity: 0.5 }}>
                Waiting for response...
              </div>
            )}
          </div>

          {session.toolEvents.length > 0 && (
            <div className={styles.sessionDetailSection}>
              <div className={styles.sectionTitle}>Tool Calls ({session.toolEvents.length})</div>
              {session.toolEvents.map((event, idx) => (
                <div key={idx} className={styles.toolEvent}>
                  <div className={styles.toolEventHeader}>
                    {event.type.replace('tool_execution_', '')} — {event.toolName}
                  </div>
                  {event.args && <div>args: {truncateText(event.args, 200)}</div>}
                  {event.partialResult && (
                    <div>partial: {truncateText(event.partialResult, 200)}</div>
                  )}
                  {event.result && <div>result: {truncateText(event.result, 200)}</div>}
                  {event.isError && <div style={{ color: 'var(--semi-color-danger)' }}>error</div>}
                </div>
              ))}
            </div>
          )}

          {session.error && <div className={styles.errorText}>{session.error}</div>}

          {session.status === 'completed' && session.streamingContent && (
            <div className={styles.sessionDetailSection}>
              <div className={styles.sectionTitle}>Response</div>
              <div className={`${styles.messageBubble} ${styles.assistant}`}>
                <div className={styles.messageRole}>assistant</div>
                <div>{session.streamingContent}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.sessionPanelContainer}>
      <div className={styles.sessionPanelHeader}>
        <div className={styles.sessionPanelTitle}>
          {selectedSession ? 'Session Detail' : 'LLM Sessions'}
        </div>
        <Button
          className={styles.sessionPanelClose}
          type="tertiary"
          icon={<IconClose />}
          size="small"
          theme="borderless"
          onClick={closePanel}
        />
      </div>
      {selectedSession ? renderSessionDetail() : renderSessionList()}
    </div>
  );
};
