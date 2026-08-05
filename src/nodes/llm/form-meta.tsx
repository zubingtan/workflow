import { useEffect, useState, useContext } from 'react';

import { FormRenderProps, FormMeta, ValidateTrigger } from '@flowgram.ai/free-layout-editor';
import { Field } from '@flowgram.ai/free-layout-editor';
import {
  PromptEditorWithVariables,
  IFlowTemplateValue,
  provideJsonSchemaOutputs,
  syncVariableTitle,
} from '@flowgram.ai/form-materials';
import { Select, Button, Typography } from '@douyinfe/semi-ui';
import { IconChevronDown, IconChevronRight } from '@douyinfe/semi-icons';

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
      value={value || undefined}
      onChange={(v) => onChange(v as string)}
      disabled={readonly}
      loading={loading}
      placeholder="Select an agent"
      optionList={agents.map((a) => {
        const m = parseAgentConfig(a.config)?.provider?.model || '';
        return { label: `${a.name}${m ? ` (${m})` : ''}`, value: a.id };
      })}
      style={{ width: '100%' }}
      size="small"
    />
  );
}

const PHASE_BADGE: Record<string, { text: string; color: string }> = {
  succeeded: { text: 'Succeeded', color: 'var(--semi-color-success)' },
  cancelled: { text: 'Cancelled', color: 'var(--semi-color-tertiary)' },
  failed: { text: 'Failed', color: 'var(--semi-color-danger)' },
};

/** Tool event row — collapsed detail by default (UX-B). */
function ToolEventRow({ ev }: { ev: ToolEvent }) {
  const [expanded, setExpanded] = useState(false);
  const label = ev.type === 'tool_start' ? 'Call' : 'Return';
  return (
    <div style={{ marginTop: 4 }}>
      <Button
        size="small"
        theme="borderless"
        icon={expanded ? <IconChevronDown /> : <IconChevronRight />}
        onClick={() => setExpanded((v) => !v)}
        style={{ padding: '0 4px' }}
      >
        <Typography.Text size="small">
          {label} {ev.toolName}
        </Typography.Text>
      </Button>
      {expanded && (
        <pre
          style={{
            margin: '4px 0 0 16px',
            padding: 4,
            background: 'var(--semi-color-fill-1)',
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
        <Button
          size="small"
          theme="solid"
          onClick={exec.run}
          disabled={!canRun || exec.isRunning}
          loading={exec.isRunning}
        >
          {exec.isRunning ? 'Running...' : 'Run Agent'}
        </Button>
        {exec.isRunning && (
          <Button size="small" theme="borderless" onClick={exec.cancel}>
            Cancel
          </Button>
        )}
        {PHASE_BADGE[exec.phase] && (
          <Typography.Text size="small" style={{ color: PHASE_BADGE[exec.phase].color }}>
            {PHASE_BADGE[exec.phase].text}
          </Typography.Text>
        )}
      </div>
      {exec.error && (
        <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
          {exec.error}
        </Typography.Text>
      )}
      {showPanel && (exec.content || exec.toolEvents.length > 0) && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: 'var(--semi-color-fill-0)',
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
  const { readonly: ctxReadonly, data: nodeData, updateData } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
  const isHistoryView = useContext(IsHistoryViewContext);
  const readonly = ctxReadonly || !isSidebar;

  const agentId = (form.getValueIn('inputsValues.agentId') as any)?.content ?? '';
  const promptVal = form.getValueIn('inputsValues.prompt') as any;
  const promptText = typeof promptVal === 'string' ? promptVal : promptVal?.content ?? '';

  // Phase 9 (#161): per-node timeout override. Stored as node.data.timeoutOverride
  //   - number > 0 → that many ms
  //   - null       → "no timeout"
  //   - undefined  → use global default
  // The backend's resolveTimeoutMs reads this with precedence:
  //   node.data.timeoutOverride > settings.global_default > env > 10min
  const timeoutOverride: number | null | undefined = nodeData?.timeoutOverride;
  const timeoutSelectValue =
    timeoutOverride === undefined
      ? 'default'
      : timeoutOverride === null
      ? 'none'
      : String(timeoutOverride);
  const onTimeoutChange = (v: string | number | undefined) => {
    if (v === undefined || v === '' || v === 'default') {
      // Clear → use global default (remove the key so fallback kicks in).
      updateData({ timeoutOverride: undefined });
    } else if (v === 'none') {
      // No timeout → null signals "no timeout" to the backend.
      updateData({ timeoutOverride: null });
    } else {
      const n = typeof v === 'number' ? v : Number(v);
      updateData({ timeoutOverride: n });
    }
  };

  return (
    <>
      <FormHeader />
      <FormContent>
        <Field<{ content?: string }> name="inputsValues.agentId">
          {({ field }) => (
            <div style={{ marginBottom: 12 }}>
              <Typography.Text size="small" strong>
                Agent
              </Typography.Text>
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
            <div style={{ marginBottom: 12 }}>
              <Typography.Text size="small" strong>
                Prompt
              </Typography.Text>
              <PromptEditorWithVariables
                value={field.value}
                onChange={(v) => field.onChange(v!)}
                readonly={readonly}
              />
            </div>
          )}
        </Field>
        <div style={{ marginBottom: 12 }}>
          <Typography.Text size="small" strong>
            Node Timeout
          </Typography.Text>
          <Select
            value={timeoutSelectValue}
            onChange={(v) => onTimeoutChange(v as string | number | undefined)}
            disabled={readonly}
            style={{ width: '100%' }}
            size="small"
            optionList={[
              { label: 'Use global default', value: 'default' },
              { label: '1 min', value: '60000' },
              { label: '5 min', value: '300000' },
              { label: '10 min', value: '600000' },
              { label: '30 min', value: '1800000' },
              { label: 'No timeout', value: 'none' },
            ]}
          />
        </div>
        {/* Structured Output Schema (#247): edits node.data.outputs as a flat
            field list; only valid states are persisted. Sidebar only — the
            canvas card stays compact; readonly in history view (the persisted
            declaration is shown). */}
        {isSidebar && (
          <div style={{ marginBottom: 12 }}>
            <StructuredOutputEditor
              value={nodeData?.outputs}
              onChange={(schema) => updateData({ outputs: schema })}
              readonly={readonly}
            />
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
