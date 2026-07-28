import { useCallback, useEffect, useState } from 'react';

import { Button, InputNumber, Typography, Spin, Toast } from '@douyinfe/semi-ui';

import * as api from '../../api';

/**
 * Phase 9 (#161): Admin settings page.
 *
 * Edits the global `node_timeout_default_ms` — the per-node execution timeout
 * fallback when a node has no `node.data.timeoutOverride`. Stored in the
 * `settings` table (Phase 1). Per-node overrides live in the node form.
 *
 * Validation mirrors the server (server/settings.mjs): integer > 0, <= 24h.
 * The server is the source of truth — client validation is advisory.
 */
export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState<number | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .getSettings()
      .then((s) => setValue(s.node_timeout_default_ms))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => reload(), [reload]);

  const save = async () => {
    if (value == null) {
      Toast.warning('请输入超时值（毫秒）');
      return;
    }
    if (!Number.isInteger(value) || value <= 0) {
      Toast.error('必须为正整数');
      return;
    }
    const MAX = 24 * 60 * 60 * 1000;
    if (value > MAX) {
      Toast.error(`不能超过 24 小时（${MAX} 毫秒）`);
      return;
    }
    setSaving(true);
    try {
      await api.updateSettings({ node_timeout_default_ms: value });
      Toast.success('已保存');
      reload();
    } catch (err: any) {
      Toast.error(err?.message || '保存失败');
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
        全局设置
      </Typography.Title>
      <Typography.Paragraph type="tertiary" style={{ marginBottom: 24 }}>
        节点超时默认值用于没有单独设置超时的节点。每个节点可在节点表单中单独覆盖此值。
      </Typography.Paragraph>
      <div style={{ marginBottom: 12 }}>
        <Typography.Text size="small" strong>
          节点超时默认值（毫秒）
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
          1 分钟 = 60000 毫秒；10 分钟 = 600000 毫秒；0 或留空表示使用内置默认（10 分钟）
        </Typography.Text>
      </div>
      <div style={{ marginTop: 16 }}>
        <Button theme="solid" loading={saving} onClick={save}>
          保存
        </Button>
      </div>
    </div>
  );
}
