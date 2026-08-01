import { useCallback, useEffect, useState } from 'react';

import { Button, Input, InputNumber, Typography, Spin, Toast } from '@douyinfe/semi-ui';

import * as api from '../../api';

/**
 * Phase 9 (#161): Admin settings page.
 *
 * Edits the global `node_timeout_default_ms` — the per-node execution timeout
 * fallback when a node has no `node.data.timeoutOverride`. Stored in the
 * `settings` table (Phase 1). Per-node overrides live in the node form.
 *
 * T3 (#215): mem0 memory server connection settings (host + API key).
 *
 * Validation mirrors the server (server/settings.mjs): integer > 0, <= 24h.
 * The server is the source of truth — client validation is advisory.
 */
export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<number | null>(null);
  const [mem0Host, setMem0Host] = useState<string>('');
  const [mem0ApiKey, setMem0ApiKey] = useState<string>('');

  const reload = useCallback(() => {
    setLoading(true);
    api
      .getSettings()
      .then((s) => {
        setValue(s.node_timeout_default_ms);
        setMem0Host(s.mem0_host ?? '');
        setMem0ApiKey(s.mem0_api_key ?? '');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  const save = async () => {
    if (value == null) {
      Toast.warning('Please enter a timeout value (ms)');
      return;
    }
    if (!Number.isInteger(value) || value <= 0) {
      Toast.error('Must be a positive integer');
      return;
    }
    const MAX = 24 * 60 * 60 * 1000;
    if (value > MAX) {
      Toast.error(`Cannot exceed 24 hours (${MAX} ms)`);
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<api.AppSettings> = { node_timeout_default_ms: value };
      // Send trimmed value or null (null clears the setting on the server).
      patch.mem0_host = mem0Host.trim() || null;
      patch.mem0_api_key = mem0ApiKey.trim() || null;
      await api.updateSettings(patch);
      Toast.success('Saved');
      reload();
    } catch (err: any) {
      Toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
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
          placeholder="Admin API key"
          mode="password"
          style={{ width: '100%', marginTop: 4 }}
        />
        <Typography.Text type="tertiary" size="small">
          The admin API key for authenticating with the mem0 server
        </Typography.Text>
      </div>
      <div style={{ marginTop: 16 }}>
        <Button theme="solid" loading={saving} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
