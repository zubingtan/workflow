import { useEffect, useMemo, useState } from 'react';

import { providerConnectionFingerprint } from '../agent-config-store.mjs';
import { Button, Input, Select, Tag, Typography } from '../../ui/management';
import * as api from '../../../api';
import type { AgentConfig, AgentDef } from '../../../api';

export interface ProviderDraft {
  provider: AgentConfig['provider'];
  models: api.ProviderModel[];
  modelListToken: string;
  testToken: string;
  state: 'idle' | 'loading-models' | 'models-loaded' | 'testing' | 'tested' | 'error' | 'saving';
  error?: string;
}

interface Props {
  agent: AgentDef;
  config: Record<string, any>;
  drafts: Map<string, ProviderDraft>;
  onDraftChange: (id: string, draft: ProviderDraft) => void;
  onSaved: (agent: AgentDef) => void;
  saveConfig: (patch: Record<string, any>) => void;
  saveProvider: (
    id: string,
    provider: AgentConfig['provider'],
    testToken: string
  ) => Promise<AgentDef>;
}

function initialProvider(config: Record<string, any>): AgentConfig['provider'] {
  return {
    ...(config.provider ?? {}),
    base_url: config.provider?.base_url ?? '',
    api_key: config.provider?.api_key ?? '',
    model: config.provider?.model ?? '',
  };
}

function providerEndpointFingerprint(provider: Partial<AgentConfig['provider']> = {}) {
  return JSON.stringify({
    base_url: typeof provider.base_url === 'string' ? provider.base_url.trim() : '',
    api_key: typeof provider.api_key === 'string' ? provider.api_key.trim() : '',
  });
}

export function ProviderSection({
  agent,
  config,
  drafts,
  onDraftChange,
  onSaved,
  saveConfig,
  saveProvider,
}: Props) {
  const persistedProvider = useMemo(() => initialProvider(config), [config]);
  const sessionOpts = config.session_options || {};
  const [thinkingLevel, setThinkingLevel] = useState(sessionOpts.thinkingLevel || '');
  const [draft, setDraft] = useState<ProviderDraft>(
    () =>
      drafts.get(agent.id) ?? {
        provider: persistedProvider,
        models: [],
        modelListToken: '',
        testToken: '',
        state: 'idle',
      }
  );

  useEffect(() => {
    const existing = drafts.get(agent.id);
    if (existing) {
      setDraft(existing);
      return;
    }
    const next = {
      provider: persistedProvider,
      models: [],
      modelListToken: '',
      testToken: '',
      state: 'idle' as const,
    };
    setDraft(next);
    onDraftChange(agent.id, next);
  }, [agent.id, drafts, onDraftChange, persistedProvider]);

  useEffect(() => {
    setThinkingLevel(config.session_options?.thinkingLevel || '');
  }, [agent.id, config]);

  const updateDraft = (next: ProviderDraft) => {
    setDraft(next);
    onDraftChange(agent.id, next);
  };

  const currentDraft = () => drafts.get(agent.id) ?? draft;

  const updateProvider = (patch: Partial<AgentConfig['provider']>) => {
    const current = currentDraft();
    const nextProvider = { ...current.provider, ...patch };
    const baseChanged =
      nextProvider.base_url !== current.provider.base_url ||
      nextProvider.api_key !== current.provider.api_key;
    const modelChanged = nextProvider.model !== current.provider.model;
    updateDraft({
      ...current,
      provider: nextProvider,
      ...(baseChanged
        ? { models: [], modelListToken: '', testToken: '', state: 'idle' as const }
        : modelChanged
        ? { testToken: '', state: 'models-loaded' as const }
        : {}),
      error: undefined,
    });
  };

  const loadModels = async () => {
    const current = currentDraft();
    if (!current.provider.base_url.trim() || !current.provider.api_key.trim()) {
      updateDraft({
        ...current,
        state: 'error',
        error: 'Provider Base URL and API Key are required.',
      });
      return;
    }
    const requestProvider = current.provider;
    const requestEndpoint = providerEndpointFingerprint(requestProvider);
    updateDraft({ ...current, state: 'loading-models', error: undefined });
    try {
      const result = await api.getProviderModels(agent.id, requestProvider);
      const latest = currentDraft();
      if (providerEndpointFingerprint(latest.provider) !== requestEndpoint) return;
      const selectedModel = result.models.some((model) => model.id === latest.provider.model)
        ? latest.provider.model
        : '';
      updateDraft({
        ...latest,
        provider: { ...latest.provider, model: selectedModel },
        models: result.models,
        modelListToken: result.model_list_token,
        testToken: '',
        state: 'models-loaded',
        error: undefined,
      });
    } catch (err: any) {
      const latest = currentDraft();
      if (providerEndpointFingerprint(latest.provider) !== requestEndpoint) return;
      updateDraft({
        ...latest,
        state: 'error',
        error: err?.message ?? 'Failed to load model list.',
      });
    }
  };

  const runTest = async () => {
    const current = currentDraft();
    if (!current.provider.model || !current.modelListToken) {
      updateDraft({
        ...current,
        state: 'error',
        error: 'Load the model list and select a model first.',
      });
      return;
    }
    const requestProvider = current.provider;
    const requestFingerprint = providerConnectionFingerprint(requestProvider);
    const requestModelListToken = current.modelListToken;
    updateDraft({ ...current, state: 'testing', error: undefined });
    try {
      const result = await api.testProvider(agent.id, requestProvider, requestModelListToken);
      const latest = currentDraft();
      if (providerConnectionFingerprint(latest.provider) !== requestFingerprint) return;
      updateDraft({ ...latest, testToken: result.test_token, state: 'tested', error: undefined });
    } catch (err: any) {
      const latest = currentDraft();
      if (providerConnectionFingerprint(latest.provider) !== requestFingerprint) return;
      updateDraft({
        ...latest,
        testToken: '',
        state: 'error',
        error: err?.message ?? 'Provider test failed.',
      });
    }
  };

  const save = async () => {
    const current = currentDraft();
    if (!current.testToken) return;
    const requestProvider = current.provider;
    const requestFingerprint = providerConnectionFingerprint(requestProvider);
    const requestTestToken = current.testToken;
    updateDraft({ ...current, state: 'saving', error: undefined });
    try {
      const saved = await saveProvider(agent.id, requestProvider, requestTestToken);
      onSaved(saved);
      const latest = currentDraft();
      if (providerConnectionFingerprint(latest.provider) !== requestFingerprint) return;
      updateDraft({ ...latest, state: 'tested', error: undefined });
    } catch (err: any) {
      const latest = currentDraft();
      if (providerConnectionFingerprint(latest.provider) !== requestFingerprint) return;
      updateDraft({ ...latest, state: 'error', error: err?.message ?? 'Provider save failed.' });
    }
  };

  const pricing = (draft.provider.pricing ?? {}) as Record<string, number>;
  const selectedModel = draft.models.find((model) => model.id === draft.provider.model);
  const capabilities = Object.entries(selectedModel?.capabilities ?? {});
  const canSave =
    !!draft.provider.base_url.trim() &&
    !!draft.provider.api_key.trim() &&
    !!draft.provider.model &&
    draft.models.some((model) => model.id === draft.provider.model) &&
    !!draft.testToken;
  return (
    <div style={{ maxWidth: 620 }}>
      <h3 style={{ marginBottom: 8 }}>Provider</h3>
      <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 16 }}>
        Load the provider model list, select a model, then run a safe completion test before saving.
      </Typography.Text>

      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="provider-base-url">
          Provider Base URL
        </label>
        <Input
          id="provider-base-url"
          value={draft.provider.base_url}
          onChange={(value) => updateProvider({ base_url: value })}
          placeholder="https://api.openai.com/v1"
        />
      </div>
      <div style={{ marginBottom: 16 }}>
        <label style={labelStyle} htmlFor="provider-api-key">
          API Key
        </label>
        <Input
          id="provider-api-key"
          mode="password"
          value={draft.provider.api_key}
          onChange={(value) => updateProvider({ api_key: value })}
        />
        <Typography.Text type="tertiary" size="small">
          Supports $ENV_VAR format; the server resolves it for testing.
        </Typography.Text>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle} htmlFor="provider-model">
            Model
          </label>
          <Select
            id="provider-model"
            value={draft.provider.model || undefined}
            onChange={(value) => updateProvider({ model: value as string })}
            disabled={draft.models.length === 0}
            placeholder="Load models first"
            style={{ width: '100%' }}
          >
            {draft.models.map((model) => (
              <Select.Option key={model.id} value={model.id}>
                {model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id}
              </Select.Option>
            ))}
          </Select>
        </div>
        <Button onClick={() => void loadModels()} loading={draft.state === 'loading-models'}>
          Load Models
        </Button>
      </div>

      {selectedModel && (
        <div
          style={{
            marginBottom: 20,
            padding: 12,
            border: '1px solid var(--border)',
            borderRadius: 6,
          }}
        >
          <Typography.Text strong style={{ display: 'block', marginBottom: 10 }}>
            Model information (from provider)
          </Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ModelInfo
              label="Context window"
              value={formatTokenLimit(selectedModel.max_input_tokens)}
            />
            <ModelInfo
              label="Max output"
              value={formatTokenLimit(selectedModel.max_output_tokens)}
            />
          </div>
          {capabilities.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <Typography.Text type="tertiary" size="small">
                Capabilities
              </Typography.Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {capabilities.map(([key, value]) => (
                  <Tag key={key} color={value === false ? 'grey' : 'blue'}>
                    {key.replace(/_/g, ' ')}: {String(value)}
                  </Tag>
                ))}
              </div>
            </div>
          )}
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 8 }}>
            Missing capabilities remain unknown; Provider filter IDs are not used to infer Thinking
            parameters.
          </Typography.Text>
        </div>
      )}

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>Pricing ($/M tokens)</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => (
          <div key={key}>
            <label style={{ ...labelStyle, textTransform: 'capitalize' }}>{key}</label>
            <Input
              type="number"
              size="small"
              value={String(pricing[key] ?? 0)}
              onChange={(value) => {
                updateProvider({
                  pricing: {
                    ...pricing,
                    [key]: Number(value) || 0,
                  } as AgentConfig['provider']['pricing'],
                });
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle} htmlFor="provider-thinking-level">
          Thinking Level
        </label>
        <Select
          id="provider-thinking-level"
          value={thinkingLevel}
          onChange={(value) => {
            const next = value as string;
            setThinkingLevel(next);
            saveConfig({ session_options: { thinkingLevel: next || undefined } });
          }}
          placeholder="Default (medium)"
          style={{ width: 200 }}
        >
          {THINKING_LEVELS.map((level) => (
            <Select.Option key={level} value={level}>
              {level}
            </Select.Option>
          ))}
        </Select>
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
          The common Agent levels remain available; provider-specific mappings are not inferred yet.
        </Typography.Text>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button
          theme="solid"
          onClick={() => void runTest()}
          loading={draft.state === 'testing'}
          disabled={!draft.modelListToken || !draft.provider.model}
        >
          Test Provider
        </Button>
        <Button
          theme="solid"
          type="primary"
          onClick={() => void save()}
          loading={draft.state === 'saving'}
          disabled={!canSave}
        >
          Save Provider
        </Button>
        {draft.state === 'tested' && <Typography.Text type="success">Test passed</Typography.Text>}
      </div>
      {draft.error && (
        <Typography.Text type="danger" style={{ display: 'block', marginTop: 10 }}>
          {draft.error}
        </Typography.Text>
      )}
    </div>
  );
}

const labelStyle = {
  display: 'block',
  marginBottom: 4,
  fontSize: 13,
  fontWeight: 500,
} as const;

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function formatTokenLimit(value: number | null | undefined) {
  if (value === null) return 'Not applicable';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Not provided by provider';
  return value.toLocaleString();
}

function ModelInfo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
        {label}
      </Typography.Text>
      <Typography.Text>{value}</Typography.Text>
    </div>
  );
}
