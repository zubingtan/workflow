/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useRef, useCallback } from 'react';

import { Button } from '@douyinfe/semi-ui';
import { IconPlay, IconStop } from '@douyinfe/semi-icons';

import { sessionManager, consumeLLMStream, type Session } from '../../../services';
import { useNodeRenderContext, useIsSidebar } from '../../../hooks';

const PREVIEW_MAX_LENGTH = 120;

export function truncateText(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max) + '...';
}

function extractFlowValueContent(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }
  const content = (value as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (typeof content === 'number') {
    return String(content);
  }
  return '';
}

function findActiveSessionForNode(nodeId: string): Session | undefined {
  return sessionManager.getAll().find((s) => s.nodeId === nodeId && s.status === 'streaming');
}

export function StreamSection() {
  const { node, form, readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
  const [activeSession, setActiveSession] = useState<Session | undefined>(undefined);
  const [previewContent, setPreviewContent] = useState('');
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const existing = findActiveSessionForNode(node.id);
    if (existing) {
      setActiveSession(existing);
      setPreviewContent(existing.streamingContent);
    }

    return sessionManager.subscribe(() => {
      const session = findActiveSessionForNode(node.id);
      setActiveSession(session);
      if (session) {
        setPreviewContent(session.streamingContent);
      } else {
        const lastSession = sessionManager
          .getAll()
          .find((s) => s.nodeId === node.id && s.status === 'completed');
        if (lastSession) {
          setPreviewContent(lastSession.streamingContent);
        }
      }
    });
  }, [node.id]);

  const handleStream = useCallback(async () => {
    if (activeSession) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }

    const apiHost = extractFlowValueContent(form?.getValueIn('inputsValues.apiHost'));
    const modelName = extractFlowValueContent(form?.getValueIn('inputsValues.modelName'));
    const apiKey = extractFlowValueContent(form?.getValueIn('inputsValues.apiKey'));
    const systemPrompt = extractFlowValueContent(form?.getValueIn('inputsValues.systemPrompt'));
    const prompt = extractFlowValueContent(form?.getValueIn('inputsValues.prompt'));
    const temperatureValue = form?.getValueIn('inputsValues.temperature');
    const temperature =
      typeof temperatureValue === 'object' && temperatureValue !== null
        ? Number((temperatureValue as { content?: unknown }).content) || 0.5
        : 0.5;

    if (!prompt) {
      return;
    }

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const nodeTitle = extractFlowValueContent(form?.getValueIn('title'));
    const session = sessionManager.create(node.id, nodeTitle || undefined, messages);
    setActiveSession(session);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    await consumeLLMStream({
      apiHost: apiHost || 'http://localhost:4001',
      model: modelName || 'gpt-3.5-turbo',
      apiKey,
      temperature,
      messages,
      sessionId: session.id,
      signal: abortController.signal,
    });

    abortControllerRef.current = null;

    const finalSession = sessionManager.get(session.id);
    if (finalSession?.status === 'completed' && finalSession.streamingContent) {
      form?.setValueIn('streamingResult', finalSession.streamingContent);
    }
  }, [activeSession, form, node.id]);

  const isStreaming = activeSession?.status === 'streaming';
  const hasContent = previewContent.length > 0;
  const statusText = activeSession
    ? activeSession.status === 'streaming'
      ? 'Streaming...'
      : activeSession.status === 'completed'
      ? 'Completed'
      : activeSession.status === 'error'
      ? `Error: ${activeSession.error}`
      : 'Aborted'
    : '';

  const displayContent = isSidebar
    ? previewContent
    : truncateText(previewContent, PREVIEW_MAX_LENGTH);

  if (!isSidebar && !hasContent && !isStreaming) {
    return (
      <Button
        onClick={handleStream}
        disabled={readonly}
        icon={<IconPlay size="small" />}
        size="small"
        theme="light"
        style={{ width: '100%' }}
      >
        Stream
      </Button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Button
        onClick={handleStream}
        disabled={readonly && !isStreaming}
        icon={isStreaming ? <IconStop size="small" /> : <IconPlay size="small" />}
        size="small"
        theme="light"
        type={isStreaming ? 'danger' : 'primary'}
        style={{ width: '100%' }}
      >
        {isStreaming ? 'Stop' : 'Stream'}
      </Button>
      {hasContent && (
        <div
          style={{
            padding: '6px 8px',
            background: 'var(--semi-color-fill-0)',
            borderRadius: 4,
            fontSize: isSidebar ? 13 : 11,
            lineHeight: 1.4,
            color: 'var(--semi-color-text-2)',
            maxHeight: isSidebar ? 200 : 60,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {displayContent}
          {isStreaming && <span style={{ opacity: 0.5, animation: 'blink 1s infinite' }}>▋</span>}
        </div>
      )}
      {statusText && (
        <div
          style={{
            fontSize: 11,
            color:
              activeSession?.status === 'error'
                ? 'var(--semi-color-danger)'
                : 'var(--semi-color-text-2)',
          }}
        >
          {statusText}
        </div>
      )}
    </div>
  );
}
