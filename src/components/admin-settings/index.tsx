import { useCallback, useEffect, useState } from 'react';

import { Button, Input, InputNumber, Typography, Spin, Toast } from '@douyinfe/semi-ui';

import * as api from '../../api';

/**
 * Phase 9 (#161) + mem0 (#212 D12): Admin settings page.
 *
 * Edits:
 *   - node_timeout_default_ms — global per-node execution timeout fallback.
 *   - mem0_host / mem0_api_key — the self-hosted mem0 server the agents'
 *     persistent memory extension talks to (empty host disables memory).
 *
 * Stored in the `settings` table. Validation mirrors the server
 * (server/settings.mjs): timeout is integer > 0, <= 24h; mem0_host is an
 * http(s) URL (empty allowed); mem0_api_key is a free-form string. The server
 * is the source of truth — client validation is advisory.
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
    if (mem0Host !== '') {
      let parsed: URL;
      try {
        parsed = new URL(mem0Host);
      } catch {
        Toast.error('Mem0 server URL must be a valid URL');
        return;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        Toast.error('Mem0 server URL must be http(s)');
        return;
      }
    }
    setSaving(true);
    try {
      await api.updateSettings({
        node_timeout_default_ms: value,
        mem0_host: mem0Host,
        mem0_api_key: mem0ApiKey,
      });
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
        override this value in its node form. The mem0 settings configure the self-hosted memory
        server used by agents to remember facts across runs.
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
      <div style={{ marginTop: 24, marginBottom: 12 }}>
        <Typography.Title heading={6} style={{ marginBottom: 4 }}>
          Mem0 Memory Server
        </Typography.Title>
        <Typography.Text type="tertiary" size="small">
          Agents auto-capture and recall persistent memories via this self-hosted mem0 server. Leave
          the URL empty to disable agent memory.
        </Typography.Text>
        <div style={{ marginTop: 8 }}>
          <Typography.Text size="small" strong>
            Server URL
          </Typography.Text>
          <Input
            value={mem0Host}
            placeholder="http://localhost:8890"
            onChange={(v) => setMem0Host(v)}
            style={{ width: '100%', marginTop: 4 }}
          />
          <Typography.Text type="tertiary" size="small">
            The mem0 REST API base URL (e.g. http://localhost:8890)
          </Typography.Text>
        </div>
        <div style={{ marginTop: 8 }}>
          <Typography.Text size="small" strong>
            API Key
          </Typography.Text>
          <Input
            mode="password"
            value={mem0ApiKey}
            placeholder="ADMIN_API_KEY or a user API key"
            onChange={(v) => setMem0ApiKey(v)}
            style={{ width: '100%', marginTop: 4 }}
          />
          <Typography.Text type="tertiary" size="small">
            Sent as the X-API-Key header (required for delete-all)
          </Typography.Text>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <Button theme="solid" loading={saving} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
