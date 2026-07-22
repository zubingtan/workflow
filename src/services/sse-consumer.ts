/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { sessionManager, type ToolEvent } from './session-manager';

export interface SSEConsumerParams {
  apiHost: string;
  model: string;
  apiKey: string;
  temperature: number;
  messages: Array<{ role: string; content: string }>;
  sessionId: string;
  signal: AbortSignal;
}

interface SSEEvent {
  event?: string;
  data: string;
}

function parseSSEEvents(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const lines = chunk.split('\n');
  let currentEvent: (SSEEvent & { dataLines: string[] }) | null = null;

  for (const line of lines) {
    if (line === '') {
      if (currentEvent) {
        events.push({
          event: currentEvent.event,
          data: currentEvent.dataLines.join('\n'),
        });
        currentEvent = null;
      }
      continue;
    }

    if (line.startsWith('event:')) {
      if (!currentEvent) {
        currentEvent = { data: '', dataLines: [] };
      }
      currentEvent.event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      if (!currentEvent) {
        currentEvent = { data: '', dataLines: [] };
      }
      currentEvent.dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }

  if (currentEvent) {
    events.push({
      event: currentEvent.event,
      data: currentEvent.dataLines.join('\n'),
    });
  }

  return events;
}

interface ProcessResult {
  contentDelta?: string;
  done: boolean;
  error: boolean;
}

function processSSEEvent(sseEvent: SSEEvent, sessionId: string): ProcessResult {
  const data = sseEvent.data;

  if (data === '[DONE]') {
    return { done: true, error: false };
  }

  try {
    const parsed = JSON.parse(data);

    if (parsed.error) {
      sessionManager.error(sessionId, parsed.error.message || 'Unknown error');
      return { done: false, error: true };
    }

    const delta = parsed.choices?.[0]?.delta;
    if (delta?.content) {
      sessionManager.appendContent(sessionId, delta.content);
      return { contentDelta: delta.content, done: false, error: false };
    }

    if (sseEvent.event && sseEvent.event.startsWith('tool_execution_')) {
      sessionManager.addToolEvent(sessionId, {
        type: sseEvent.event as ToolEvent['type'],
        toolCallId: parsed.toolCallId || '',
        toolName: parsed.toolName || '',
        args: parsed.args,
        partialResult: parsed.partialResult,
        result: parsed.result,
        isError: parsed.isError,
      });
    }
  } catch {
    // Ignore JSON parse errors for partial or non-JSON data lines
  }

  return { done: false, error: false };
}

export async function consumeLLMStream(params: SSEConsumerParams): Promise<void> {
  const { apiHost, model, apiKey, temperature, messages, sessionId, signal } = params;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const response = await fetch(`${apiHost}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature,
      }),
      signal,
    });

    if (!response.ok) {
      sessionManager.error(sessionId, `HTTP ${response.status}: ${response.statusText}`);
      return;
    }

    if (!response.body) {
      sessionManager.error(sessionId, 'Response body is empty');
      return;
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lastCompleteIdx = buffer.lastIndexOf('\n\n');
      if (lastCompleteIdx === -1) {
        continue;
      }

      const completeChunk = buffer.slice(0, lastCompleteIdx + 2);
      buffer = buffer.slice(lastCompleteIdx + 2);

      const events = parseSSEEvents(completeChunk);
      for (const sseEvent of events) {
        const result = processSSEEvent(sseEvent, sessionId);
        if (result.contentDelta) {
          fullContent += result.contentDelta;
        }
        if (result.error) {
          return;
        }
        if (result.done) {
          sessionManager.complete(sessionId, fullContent);
          return;
        }
        const session = sessionManager.get(sessionId);
        if (session && (session.status === 'error' || session.status === 'aborted')) {
          return;
        }
      }
    }

    if (buffer.trim()) {
      const events = parseSSEEvents(buffer + '\n\n');
      for (const sseEvent of events) {
        const result = processSSEEvent(sseEvent, sessionId);
        if (result.contentDelta) {
          fullContent += result.contentDelta;
        }
        if (result.error) {
          return;
        }
        if (result.done) {
          sessionManager.complete(sessionId, fullContent);
          return;
        }
      }
    }

    const session = sessionManager.get(sessionId);
    if (session && session.status === 'streaming') {
      if (fullContent) {
        sessionManager.complete(sessionId, fullContent);
      } else {
        sessionManager.error(sessionId, 'Stream ended without content');
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      sessionManager.abort(sessionId);
    } else {
      sessionManager.error(sessionId, err instanceof Error ? err.message : String(err));
    }
  } finally {
    if (reader) {
      reader.releaseLock();
    }
  }
}
