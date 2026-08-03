import { useCallback, useEffect, useState } from 'react';

import { Button, Input, InputNumber, Typography, Spin, Toast, Tag } from '@douyinfe/semi-ui';
import { IconTickCircle, IconClose } from '@douyinfe/semi-icons';

import * as api from '../../api';

/**
 * Phase 9 (#161): Admin settings page.
 *
 * Edits the global `node_timeout_default_ms` — the per-node execution timeout
 * fallback when a node has no `node.data.timeoutOverride`. Stored in the
 * `settings` table (Phase 1). Per-node overrides live in the node form.
 *
 * T3 (#215): mem0 memory server connection settings (host + API key).
 * Follow-up: mem0 admin key + LLM/embedding provider config pushed to the
 * mem0 server via POST /configure, plus a one-click end-to-end Test button.
 *
 * Validation mirrors the server (server/settings.mjs). The server is the
 * source of truth — client validation is advisory.
 */
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [value, setValue] = useState<number | null>(null);
  const [mem0Host, setMem0Host] = useState<string>('');
  const [mem0ApiKey, setMem0ApiKey] = useState<string>('');
  const [mem0AdminKey, setMem0AdminKey] = useState<string>('');
  const [llmBaseUrl, setLlmBaseUrl] = useState<string>('');
  const [llmModel, setLlmModel] = useState<string>('');
  const [embedderModel, setEmbedderModel] = useState<string>('');
  const [embeddingDims, setEmbeddingDims] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<api.Mem0TestResponse | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .getSettings()
      .then((s) => {
        setValue(s.node_timeout_default_ms);
        setMem0Host(s.mem0_host ?? '');
        setMem0ApiKey(s.mem0_api_key ?? '');
        setMem0AdminKey(s.mem0_admin_key ?? '');
        setLlmBaseUrl(s.mem0_llm_base_url ?? '');
        setLlmModel(s.mem0_llm_model ?? '');
        setEmbedderModel(s.mem0_embedder_model ?? '');
        setEmbeddingDims(s.mem0_embedding_dims);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  const save = async () => {
    if (value != null && (!Number.isInteger(value) || value <= 0)) {
      Toast.error('Must be a positive integer');
      return;
    }
    if (value != null && value > MAX_TIMEOUT_MS) {
      Toast.error(`Cannot exceed 24 hours (${MAX_TIMEOUT_MS} ms)`);
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<api.AppSettings> = {
        // null clears the timeout setting (mem0-only setups leave it empty).
        node_timeout_default_ms: value,
        // Send trimmed value or null (null clears the setting on the server).
        mem0_host: mem0Host.trim() || null,
        mem0_api_key: mem0ApiKey.trim() || null,
        mem0_admin_key: mem0AdminKey.trim() || null,
        mem0_llm_base_url: llmBaseUrl.trim() || null,
        mem0_llm_model: llmModel.trim() || null,
        mem0_embedder_model: embedderModel.trim() || null,
        mem0_embedding_dims: embeddingDims,
      };
      await api.updateSettings(patch);

      // Push LLM/embedding config to the mem0 server (requires admin key).
      if (
        patch.mem0_host &&
        (patch.mem0_llm_model || patch.mem0_embedder_model || patch.mem0_llm_base_url)
      ) {
        const cfgResult = await api.configureMem0({
          llm_base_url: patch.mem0_llm_base_url,
          llm_model: patch.mem0_llm_model,
          embedder_model: patch.mem0_embedder_model,
          embedding_dims: patch.mem0_embedding_dims,
        });
        if (!cfgResult.ok) {
          Toast.warning(
            `Saved, but mem0 configure failed: ${cfgResult.error ?? `HTTP ${cfgResult.status}`}`
          );
        } else {
          Toast.success('Saved');
        }
      } else {
        Toast.success('Saved');
      }
      reload();
    } catch (err: any) {
      Toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!mem0Host.trim() || !mem0ApiKey.trim()) {
      Toast.warning('Please fill in mem0 Server URL and API Key first');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // Ensure the settings are persisted first so the backend proxy can read them.
      await api.updateSettings({
        mem0_host: mem0Host.trim(),
        mem0_api_key: mem0ApiKey.trim(),
        mem0_admin_key: mem0AdminKey.trim() || null,
      });
      const result = await api.testMem0();
      setTestResult(result);
      if (result.ok) {
        Toast.success('mem0 test passed');
      } else {
        Toast.error('mem0 test failed — see details below');
      }
    } catch (err: any) {
      Toast.error(err?.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 560 }}>
      <Typography.Title heading={4} style={{ marginBottom: 16 }}>
        Global Settings
      </Typography.Title>
      <Typography.Paragraph type="tertiary" style={{ marginBottom: 24 }}>
        The node timeout default applies to nodes that do not set their own timeout. Each node can
        override this value in its node form.
      </Typography.Paragraph>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          Node Timeout Default (ms)
        </Typography.Text>
        <InputNumber
          value={value ?? undefined}
          min={1}
          max={24 * 60 * 60 * 1000}
          step={60000}
          onChange={(v) => setValue(typeof v === 'number' ? v : null)}
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          1 min = 60000 ms; 10 min = 600000 ms; 0 or empty uses the built-in default (10 min)
        </Typography.Text>
      </div>
      <Typography.Title heading={5} style={{ marginTop: 24, marginBottom: 12 }}>
        Memory (mem0)
      </Typography.Title>
      <Typography.Paragraph type="tertiary" style={{ marginBottom: 16 }}>
        Configure the self-hosted mem0 server connection. Leave empty to disable persistent memory.
      </Typography.Paragraph>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          mem0 Server URL
        </Typography.Text>
        <Input
          value={mem0Host}
          onChange={(v) => setMem0Host(v)}
          placeholder="http://localhost:8890"
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          The base URL of the mem0 API server (e.g. http://localhost:8890)
        </Typography.Text>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          mem0 API Key
        </Typography.Text>
        <Input
          value={mem0ApiKey}
          onChange={(v) => setMem0ApiKey(v)}
          placeholder="API key"
          mode="password"
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          Used for memory read/write operations
        </Typography.Text>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          mem0 Admin Key (optional)
        </Typography.Text>
        <Input
          value={mem0AdminKey}
          onChange={(v) => setMem0AdminKey(v)}
          placeholder="Admin key (required for LLM/embedding configuration)"
          mode="password"
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          Only needed to push LLM/embedding settings below. Falls back to the API key when empty.
        </Typography.Text>
      </div>
      <Typography.Text size="small" strong>
        LLM / Embedding Provider
      </Typography.Text>
      <Typography.Paragraph type="tertiary" size="small" style={{ marginTop: 4 }}>
        These are pushed to the mem0 server via its /configure endpoint. The provider must be
        OpenAI-compatible (the mem0 server calls it internally for memory extraction and search).
      </Typography.Paragraph>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          LLM Base URL
        </Typography.Text>
        <Input
          value={llmBaseUrl}
          onChange={(v) => setLlmBaseUrl(v)}
          placeholder="https://open-webui.corp.pony.ai/api"
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          OpenAI-compatible endpoint (no /v1 suffix needed)
        </Typography.Text>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          LLM Model
        </Typography.Text>
        <Input
          value={llmModel}
          onChange={(v) => setLlmModel(v)}
          placeholder="deepseek-v4-flash"
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          Used by mem0 to extract facts from conversations
        </Typography.Text>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          Embedding Model
        </Typography.Text>
        <Input
          value={embedderModel}
          onChange={(v) => setEmbedderModel(v)}
          placeholder="text-embedding-v4"
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          Used by mem0 to vectorize memories
        </Typography.Text>
      </div>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          Embedding Dimensions
        </Typography.Text>
        <InputNumber
          value={embeddingDims ?? undefined}
          min={1}
          onChange={(v) => setEmbeddingDims(typeof v === 'number' ? v : null)}
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          Must match the embedding model output size (e.g. 1024 for text-embedding-v4)
        </Typography.Text>
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
        <Button theme="solid" loading={saving} onClick={save}>
          Save
        </Button>
        <Button loading={testing} onClick={runTest}>
          Test Connection
        </Button>
      </div>
      {testResult && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: 'var(--semi-color-fill-0)',
          }}
        >
          <Typography.Text
            strong
            style={{
              color: testResult.ok ? 'var(--semi-color-success)' : 'var(--semi-color-danger)',
            }}
          >
            {testResult.ok ? '✓ Test passed' : '✗ Test failed'}
          </Typography.Text>
          {(testResult.steps ?? []).map((step) => (
            <div
              key={step.name}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8 }}
            >
              {step.ok ? (
                <IconTickCircle style={{ color: 'var(--semi-color-success)', marginTop: 2 }} />
              ) : (
                <IconClose style={{ color: 'var(--semi-color-danger)', marginTop: 2 }} />
              )}
              <div>
                <Tag size="small" color={step.ok ? 'green' : 'red'} style={{ marginRight: 8 }}>
                  {step.name}
                </Tag>
                <Typography.Text type="tertiary" size="small">
                  {step.detail}
                </Typography.Text>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
