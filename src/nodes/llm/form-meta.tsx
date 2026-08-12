import { useEffect, useState, useContext } from 'react';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { Field } from '@flowgram.ai/free-layout-editor';
import { FormRenderProps, FormMeta, ValidateTrigger } from '@flowgram.ai/free-layout-editor';

import { PromptEditorWithVariables } from '@/form-semantics';
import { provideJsonSchemaOutputs, syncVariableTitle } from '@/form-semantics';
import type { IFlowTemplateValue } from '@/form-semantics';
import { Button, Select } from '@/components/ui';

import type { JsonSchema } from '../../typings/json-schema';
import { FlowNodeJSON } from '../../typings';
import { useNodeRenderContext, useIsSidebar } from '../../hooks';
import { FormHeader, FormContent } from '../../form-components';
import { IsHistoryViewContext } from '../../context';
import { NodeStatusBar } from '../../components/testrun/node-status-bar';
import { parseAgentConfig } from '../../components/agent-miller/agent-config-store.mjs';
import * as api from '../../api';
import { useAgentExecution } from '../../agent-execution/use-agent-execution';
import type { ToolEvent } from '../../agent-execution/types';
import { StructuredOutputEditor } from './structured-output-editor';

/** Fetch agent list from backend via the shared HTTP client (AGENTS.md). */
function useAgents() {
  const [agents, setAgents] = useState<api.AgentDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .listAgents()
      .then((rows) => {
        if (!cancelled) setAgents(rows);
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { agents, loading };
}

/** Agent Select — interactive, used in sidebar */
function AgentSelect({
  value,
  onChange,
  readonly,
}: {
  value?: string;
  onChange: (v: string) => void;
  readonly?: boolean;
}) {
  const { agents, loading } = useAgents();

  return (
    <Select
      aria-label="Agent"
      value={value || ''}
      onChange={(event) => onChange(event.currentTarget.value)}
      disabled={readonly}
    >
      {!value && <option value="">{loading ? 'Loading agents…' : 'Select an agent'}</option>}
      {agents.map((a) => {
        const m = parseAgentConfig(a.config)?.provider?.model || '';
        return <option key={a.id} value={a.id}>{`${a.name}${m ? ` (${m})` : ''}`}</option>;
      })}
    </Select>
  );
}

const PHASE_BADGE: Record<string, { text: string; color: string }> = {
  succeeded: { text: 'Succeeded', color: 'var(--app-color-success)' },
  cancelled: { text: 'Cancelled', color: 'var(--muted-foreground)' },
  failed: { text: 'Failed', color: 'var(--destructive)' },
};

/** Tool event row — collapsed detail by default (UX-B). */
function ToolEventRow({ ev }: { ev: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const label = ev.type === 'tool_start' ? 'Call' : 'Return';
  return (
    <div style={{ marginTop: 4 }}>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
        <span className="text-xs">
          {label} {ev.toolName}
        </span>
      </Button>
      {expanded && (
        <pre
          style={{
            margin: '4px 0 0 16px',
            padding: 4,
            background: 'var(--muted)',
            borderRadius: 4,
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {ev.type === 'tool_start'
            ? JSON.stringify(ev.args ?? null, null, 2)
            : JSON.stringify(ev.result ?? null, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Agent Execution output display + run/cancel controls (#54). */
function AgentOutput({ agentId, prompt }: { agentId: string; prompt: string }) {
  const exec = useAgentExecution({ agentId, prompt });
  const canRun = !!agentId && !!prompt;
  // Show the panel whenever there's anything to show: streaming, terminal,
  // or any content/error/tool events.
  const showPanel = exec.phase !== 'idle';

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button size="sm" onClick={exec.run} disabled={!canRun || exec.isRunning}>
          {exec.isRunning ? 'Running...' : 'Run Agent'}
        </Button>
        {exec.isRunning && (
          <Button size="sm" variant="ghost" onClick={exec.cancel}>
            Cancel
          </Button>
        )}
        {PHASE_BADGE[exec.phase] && (
          <span className="text-xs" style={{ color: PHASE_BADGE[exec.phase].color }}>
            {PHASE_BADGE[exec.phase].text}
          </span>
        )}
      </div>
      {exec.error && <span className="mt-1 block text-xs text-destructive">{exec.error}</span>}
      {showPanel && (exec.content || exec.toolEvents.length > 0) && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: 'var(--muted)',
            borderRadius: 4,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 240,
            overflow: 'auto',
          }}
        >
          {exec.content && <div>{exec.content}</div>}
          {exec.toolEvents.length > 0 && (
            <div style={{ marginTop: 4 }}>
              {exec.toolEvents.map((ev, i) => (
                <ToolEventRow key={i} ev={ev} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** LLM form render — same layout, readonly on canvas card */
function LLMFormRender({ form }: FormRenderProps<FlowNodeJSON>) {
  const { readonly: ctxReadonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
  const isHistoryView = useContext(IsHistoryViewContext);
  const readonly = ctxReadonly || !isSidebar;

  const agentId = (form.getValueIn('inputsValues.agentId') as any)?.content ?? '';
  const promptVal = form.getValueIn('inputsValues.prompt') as any;
  const promptText = typeof promptVal === 'string' ? promptVal : promptVal?.content ?? '';

  return (
    <>
      <FormHeader />
      <FormContent>
        <Field<{ content?: string }> name="inputsValues.agentId">
          {({ field }) => (
            <div className="mb-3">
              <label className="text-xs font-medium">Agent</label>
              <AgentSelect
                value={field.value?.content}
                onChange={(v) => field.onChange({ type: 'constant', content: v })}
                readonly={readonly}
              />
            </div>
          )}
        </Field>
        <Field<IFlowTemplateValue> name="inputsValues.prompt">
          {({ field }) => (
            <div className="mb-3">
              <label className="text-xs font-medium">Prompt</label>
              <PromptEditorWithVariables
                value={field.value}
                onChange={(v) => field.onChange(v!)}
                readonly={readonly}
              />
            </div>
          )}
        </Field>
        {/* Phase 9 (#161): per-node timeout override via Field — form-level
            path updates only, never replaces sibling data (updateData would
            wipe inputsValues). Stored as node.data.timeoutOverride:
              - number > 0 → that many ms
              - null       → "no timeout"
              - undefined  → use global default
            Backend precedence (resolveTimeoutMs):
              node.data.timeoutOverride > settings.global_default > env > 10min */}
        <Field<number | null | undefined> name="timeoutOverride">
          {({ field }) => {
            const timeoutValue = field.value;
            const timeoutSelectValue =
              timeoutValue === undefined
                ? 'default'
                : timeoutValue === null
                ? 'none'
                : String(timeoutValue);
            return (
              <div className="mb-3">
                <label className="text-xs font-medium">Node Timeout</label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-2.5 z-10 flex items-center text-xs text-foreground">
                    {timeoutSelectValue === 'default'
                      ? 'Use global default'
                      : timeoutSelectValue === 'none'
                      ? 'No timeout'
                      : `${Number(timeoutSelectValue) / 60000} min`}
                  </span>
                  <Select
                    value={timeoutSelectValue}
                    className="bg-transparent text-transparent [&>option]:text-foreground"
                    onChange={(event) => {
                      const v = event.currentTarget.value;
                      if (v === undefined || v === '' || v === 'default') {
                        // Clear → use global default (fallback kicks in).
                        field.onChange(undefined);
                      } else if (v === 'none') {
                        // No timeout → null signals "no timeout" to the backend.
                        field.onChange(null);
                      } else {
                        field.onChange(Number(v));
                      }
                    }}
                    disabled={readonly}
                  >
                    <option value="default">Use global default</option>
                    <option value="60000">1 min</option>
                    <option value="300000">5 min</option>
                    <option value="600000">10 min</option>
                    <option value="1800000">30 min</option>
                    <option value="none">No timeout</option>
                  </Select>
                </div>
              </div>
            );
          }}
        </Field>
        {/* Structured Output Schema (#247): edits node.data.outputs as a flat
            field list; only valid states are persisted. Field-based update
            (merge-safe) — updateData would replace the whole node data and
            wipe inputsValues. Sidebar only — the canvas card stays compact;
            readonly in history view (the persisted declaration is shown). */}
        {isSidebar && (
          <div style={{ marginBottom: 12 }}>
            <Field<JsonSchema> name="outputs">
              {({ field }) => (
                <StructuredOutputEditor
                  value={field.value}
                  onChange={(schema) => field.onChange(schema)}
                  readonly={readonly}
                />
              )}
            </Field>
          </div>
        )}
        {isSidebar &&
          (isHistoryView ? (
            // Phase 8 (#160): history view renders the static terminal
            // snapshot (Inputs/Outputs/Data from the TaskReport) instead of
            // the live useAgentExecution SSE panel. NodeStatusBar subscribes
            // to the StaticHistoryRuntimeService and renders NodeStatusRender.
            <NodeStatusBar />
          ) : (
            <AgentOutput agentId={agentId} prompt={promptText} />
          ))}
      </FormContent>
    </>
  );
}

export const LLMFormMeta: FormMeta<FlowNodeJSON> = {
  render: LLMFormRender,
  validateTrigger: ValidateTrigger.onChange,
  validate: {
    title: ({ value }) => (value ? undefined : 'Title is required'),
  },
  effect: {
    title: syncVariableTitle,
    outputs: provideJsonSchemaOutputs,
  },
};
