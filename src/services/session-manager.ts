/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { nanoid } from 'nanoid';

export type SessionStatus = 'streaming' | 'completed' | 'error' | 'aborted';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolEvent {
  type: 'tool_execution_start' | 'tool_execution_update' | 'tool_execution_end';
  toolCallId: string;
  toolName: string;
  args?: string;
  partialResult?: string;
  result?: string;
  isError?: boolean;
}

export interface Session {
  id: string;
  nodeId?: string;
  nodeTitle?: string;
  messages: ChatMessage[];
  toolEvents: ToolEvent[];
  status: SessionStatus;
  createdAt: number;
  streamingContent: string;
  error?: string;
}

type Listener = () => void;

class SessionManagerClass {
  private sessions: Map<string, Session> = new Map();

  private listeners: Set<Listener> = new Set();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  create(nodeId?: string, nodeTitle?: string, messages: ChatMessage[] = []): Session {
    const session: Session = {
      id: nanoid(8),
      nodeId,
      nodeTitle,
      messages,
      toolEvents: [],
      status: 'streaming',
      createdAt: Date.now(),
      streamingContent: '',
    };
    this.sessions.set(session.id, session);
    this.emit();
    return session;
  }

  appendContent(id: string, delta: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    session.streamingContent += delta;
    this.emit();
  }

  addToolEvent(id: string, event: ToolEvent): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    session.toolEvents.push(event);
    this.emit();
  }

  complete(id: string, finalContent: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    session.status = 'completed';
    session.streamingContent = finalContent;
    session.messages.push({ role: 'assistant', content: finalContent });
    this.emit();
  }

  error(id: string, errorMessage: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    session.status = 'error';
    session.error = errorMessage;
    this.emit();
  }

  abort(id: string): void {
    const session = this.sessions.get(id);
    if (!session) {
      return;
    }
    session.status = 'aborted';
    this.emit();
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.emit();
  }

  clear(): void {
    this.sessions.clear();
    this.emit();
  }
}

export const sessionManager = new SessionManagerClass();
