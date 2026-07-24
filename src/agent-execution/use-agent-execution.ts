/**
 * useAgentExecution — the single browser-side owner of Agent Execution
 * transport, SSE framing, error handling, cancellation, and the normalized
 * phase state machine.
 *
 * Two input shapes (#54 decision 2):
 *   - { agentId, prompt }        → POST /agents/:id/run (LLM node path)
 *   - { config, prompt }         → POST /agents/test     (Agent modal Test path)
 *
 * The hook delegates the transport/state-machine core to
 * `createExecutionController` (a React-free pure function that owns fetch,
 * SSE framing, cancel, and terminal classification). The hook's only job is
 * to project the controller's event stream into React state. Deterministic
 * tests cover the controller directly (#54 decision 10).
 *
 * Cancellation (#54 decisions 6, 7, 8):
 *   - The controller (which holds the AbortController) is stored in a ref,
 *     NOT state. Cancel/re-run logic lives in callbacks, not effects, so
 *     React 18 StrictMode double-invoke cannot spuriously abort.
 *   - `cancel()` aborts the in-flight request and the controller emits a
 *     `{type:"terminal", phase:"cancelled"}` event because signal.aborted is
 *     true. The backend MAY also emit `{type:"cancelled"}` (#76); the
 *     controller consumes it as the authoritative server signal but does not
 *     depend on it.
 *   - Re-run auto-supersedes: the controller silently aborts any in-flight
 *     run before starting the new one; the superseded run emits no terminal.
 *
 * Credential boundary (CONTEXT.md): the hook never sends the API key value.
 * The test path sends `provider_api_key_env` (env var name) inside `config`;
 * the run-by-id path sends only `{ prompt }`. Resolution happens server-side.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import * as api from '../api';
import type {
  ExecutionPhase,
  ToolEvent,
  UseAgentExecutionInput,
  UseAgentExecutionResult,
} from './types';
import { createExecutionController } from './execute-agent-run.mjs';

const INITIAL_PHASE: ExecutionPhase = 'idle';

export function useAgentExecution(input: UseAgentExecutionInput): UseAgentExecutionResult {
  const [phase, setPhase] = useState<ExecutionPhase>(INITIAL_PHASE);
  const [content, setContent] = useState('');
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [error, setError] = useState('');

  // Controller in a ref: cancel/re-run logic in callbacks, not effects (#54
  // decision 7). useMemo gives us a stable controller across renders.
  const controller = useMemo(
    () =>
      createExecutionController({
        // sendRequest dispatches to src/api.ts — the sole HTTP client
        // (AGENTS.md). Two paths: by-id (LLM node) or by-config (Test modal).
        sendRequest: (reqInput: any, signal: AbortSignal) => {
          if ('agentId' in reqInput) {
            return api.runAgentById(reqInput.agentId, reqInput.prompt, signal);
          }
          return api.testAgent(reqInput.config, signal);
        },
        onEvent: (ev: any) => {
          switch (ev.type) {
            case 'phase':
              if (ev.phase === 'streaming') setPhase('streaming');
              break;
            case 'content_delta':
              setContent((prev) => prev + (ev.content ?? ''));
              break;
            case 'tool_start':
            case 'tool_end':
              setToolEvents((prev) => [...prev, ev as ToolEvent]);
              break;
            case 'terminal':
              if (ev.phase === 'succeeded') {
                setPhase('succeeded');
              } else if (ev.phase === 'cancelled') {
                setPhase('cancelled');
              } else {
                setPhase('failed');
                setError(ev.error ?? 'Agent Execution failed');
              }
              break;
            default:
              break;
          }
        },
      }),
    []
  );

  // Hold the latest input so run() always reads fresh values without being
  // recreated on every input change (run is stable across renders).
  const inputRef = useRef(input);
  inputRef.current = input;

  const run = useCallback(() => {
    // Re-run auto-supersedes inside the controller: it aborts the previous
    // run silently. Reset visible state for the new run.
    setPhase('streaming');
    setContent('');
    setToolEvents([]);
    setError('');
    controller.run(inputRef.current);
  }, [controller]);

  const cancel = useCallback(() => {
    controller.cancel();
  }, [controller]);

  return {
    phase,
    content,
    toolEvents,
    error,
    run,
    cancel,
    isRunning: phase === 'streaming',
  };
}
