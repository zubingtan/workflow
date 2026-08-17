import { useState } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui';

import type {
  ExecutionPhase,
  ToolEvent,
  UseAgentExecutionResult,
} from '../../agent-execution/types';

import styles from './index.module.less';

type AgentExecutionPanelProps = Pick<
  UseAgentExecutionResult,
  'phase' | 'content' | 'toolEvents' | 'error' | 'isRunning'
> & {
  canRun: boolean;
  prompt: string;
  onRun: UseAgentExecutionResult['run'];
  onCancel: UseAgentExecutionResult['cancel'];
};

const PHASE_LABEL: Record<ExecutionPhase, string> = {
  idle: 'Ready',
  streaming: 'Streaming',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null, null, 2) ?? 'null';
  } catch {
    return String(value);
  }
}

function ToolEventRow({ event }: { event: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const isStart = event.type === 'tool_start';
  const label = `${isStart ? 'Call' : 'Return'} ${event.toolName || 'tool'}`;
  const details = isStart ? event.args : event.result;

  return (
    <div className={styles.toolEvent}>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={expanded}
        aria-label={`${label} details`}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        <span>{label}</span>
      </Button>
      {expanded && <pre className={styles.toolEventDetails}>{stringify(details)}</pre>}
    </div>
  );
}

/**
 * Visual-only Agent Execution surface. Transport, SSE parsing, cancellation,
 * and terminal classification stay in useAgentExecution; this component only
 * renders the state it receives and dispatches the supplied callbacks.
 */
export function AgentExecutionPanel({
  phase,
  content,
  toolEvents,
  error,
  isRunning,
  canRun,
  prompt,
  onRun,
  onCancel,
}: AgentExecutionPanelProps) {
  const statusClass =
    phase === 'streaming'
      ? styles.statusStreaming
      : phase === 'succeeded'
      ? styles.statusSucceeded
      : phase === 'failed'
      ? styles.statusFailed
      : undefined;
  const actionLabel = isRunning
    ? 'Running…'
    : phase === 'succeeded' || phase === 'failed' || phase === 'cancelled'
    ? 'Retry'
    : 'Run Agent';
  // Avoid rescanning the accumulated response on every streaming delta. Only
  // terminal empty-output recovery needs to distinguish whitespace from text.
  const hasContent = phase === 'streaming' ? content.length > 0 : content.trim().length > 0;
  const hasOutput = hasContent || toolEvents.length > 0;

  return (
    <section
      className={styles.panel}
      data-testid="agent-live-session"
      data-agent-phase={phase}
      aria-label="LLM execution"
    >
      <div className={styles.header}>
        <span className={styles.title}>Live response</span>
        <span
          className={`${styles.status} ${statusClass ?? ''}`}
          data-testid="agent-execution-status"
          role="status"
          aria-live="polite"
        >
          {PHASE_LABEL[phase]}
        </span>
      </div>

      {phase !== 'idle' && (
        <div className={styles.prompt}>
          <span className={styles.label}>Prompt</span>
          <p className={styles.promptText}>{prompt || 'No prompt'}</p>
        </div>
      )}

      <div className={styles.actions}>
        <Button size="sm" onClick={onRun} disabled={!canRun || isRunning}>
          {actionLabel}
        </Button>
        {isRunning && (
          <Button size="sm" variant="destructive" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}

      {hasOutput ? (
        <div aria-live="polite">
          {hasContent && (
            <div className={styles.content} data-testid="agent-response-content">
              {content}
            </div>
          )}
          {toolEvents.length > 0 && (
            <div className={styles.toolEvents} aria-label="Tool events">
              <span className={styles.label}>Tool events ({toolEvents.length})</span>
              {toolEvents.map((event, index) => (
                <ToolEventRow key={`${event.type}-${event.toolName}-${index}`} event={event} />
              ))}
            </div>
          )}
        </div>
      ) : phase === 'streaming' ? (
        <div className={styles.emptyOutput}>Waiting for response…</div>
      ) : phase === 'succeeded' ? (
        <div className={styles.emptyOutput} data-testid="agent-empty-output">
          No output returned.
        </div>
      ) : null}
    </section>
  );
}
