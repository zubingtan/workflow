import { useEffect, useState, useCallback, useRef } from 'react';

import { FormRenderProps, FormMeta, ValidateTrigger } from '@flowgram.ai/free-layout-editor';
import { Field } from '@flowgram.ai/free-layout-editor';
import {
  PromptEditorWithVariables,
  IFlowTemplateValue,
  provideJsonSchemaOutputs,
  syncVariableTitle,
} from '@flowgram.ai/form-materials';
import { Select, Button, Typography } from '@douyinfe/semi-ui';

import { FlowNodeJSON } from '../../typings';
import { useNodeRenderContext, useIsSidebar } from '../../hooks';
import { FormHeader, FormContent } from '../../form-components';
import { SERVER_URL } from '../../api';

interface AgentDef {
  id: string;
  name: string;
  model: string;
}

/** Fetch agent list from backend */
function useAgents() {
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${SERVER_URL}/agents`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => setAgents(data))
      .catch(() => setAgents([]))
      .finally(() => setLoading(false));
    return () => controller.abort();
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
      optionList={agents.map((a) => ({ label: `${a.name} (${a.model})`, value: a.id }))}
      style={{ width: '100%' }}
      size="small"
    />
  );
}

/** SSE streaming output display + run control */
function AgentOutput({ agentId, prompt }: { agentId: string; prompt: string }) {
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (!agentId || !prompt) return;
    setRunning(true);
    setOutput('');
    setError('');
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${SERVER_URL}/agents/${agentId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'content_delta') {
              setOutput((prev) => prev + event.content);
            } else if (event.type === 'error') {
              setError(event.message);
            }
          } catch {
            // skip malformed
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Request failed');
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [agentId, prompt]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="small" theme="solid" onClick={run} disabled={running || !agentId || !prompt}>
          {running ? 'Running...' : 'Run Agent'}
        </Button>
        {running && (
          <Button size="small" theme="borderless" onClick={stop}>
            Stop
          </Button>
        )}
      </div>
      {error && (
        <Typography.Text type="danger" size="small" style={{ display: 'block', marginTop: 4 }}>
          {error}
        </Typography.Text>
      )}
      {output && (
        <div
          style={{
            marginTop: 8,
            padding: 8,
            background: 'var(--semi-color-fill-0)',
            borderRadius: 4,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: 200,
            overflow: 'auto',
          }}
        >
          {output}
        </div>
      )}
    </div>
  );
}

/** LLM form render — same layout, readonly on canvas card */
function LLMFormRender({ form }: FormRenderProps<FlowNodeJSON>) {
  const { readonly: ctxReadonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
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
        {isSidebar && <AgentOutput agentId={agentId} prompt={promptText} />}
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
