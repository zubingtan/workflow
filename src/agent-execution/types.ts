/**
 * Browser-side Agent Execution consumer — public types.
 *
 * Consumes the ordered generic SSE event sequence emitted by the backend
 * (server/sse-adapter.mjs via projectTerminal): content_delta / tool_start /
 * tool_end / finish / error / cancelled. See ADR-0001 and #54 resolution.
 *
 * Credential boundary (CONTEXT.md): the browser sends only `{ prompt }` for
 * the run-by-id path (agentId in URL), or the full config (including
 * `provider_api_key`) for the test path. The hook never sees the API key value
 * beyond passing it through to the backend.
 */

import type { AgentDef } from '../api';

/** A single tool event observed during Agent Execution. */
export interface ToolEvent {
  type: 'tool_start' | 'tool_end';
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
}

/** Terminal phases the hook can settle into. `idle` = never run. */
export type ExecutionPhase = 'idle' | 'streaming' | 'succeeded' | 'failed' | 'cancelled';

/** Normalized execution state exposed to renderers. */
export interface ExecutionState {
  phase: ExecutionPhase;
  /** Concatenated assistant text from `content_delta` events. */
  content: string;
  /** Tool calls observed so far (in arrival order). */
  toolEvents: ToolEvent[];
  /** Error message when `phase === 'failed'`; empty otherwise. */
  error: string;
}

/** Input: by saved agent id (LLM node path) — sends only `{ prompt }`. */
export interface RunByIdInput {
  agentId: string;
  prompt: string;
}

/** Input: by unsaved config (Agent modal Test path) — sends the full config.
 * `prompt` is optional; when omitted, the backend uses a default prompt. */
export interface RunByConfigInput {
  config: Partial<AgentDef>;
  prompt?: string;
}

export type UseAgentExecutionInput = RunByIdInput | RunByConfigInput;

/** Return shape of the `useAgentExecution` hook. */
export interface UseAgentExecutionResult extends ExecutionState {
  /** Start a new execution. Re-run auto-supersedes any in-flight stream. */
  run: () => void;
  /** Cancel the in-flight execution. No-op when not streaming. */
  cancel: () => void;
  /** True iff an execution is currently streaming. */
  isRunning: boolean;
}
