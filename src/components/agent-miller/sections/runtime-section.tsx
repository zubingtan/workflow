import { useEffect, useState } from 'react';

import { InputNumber, Switch, Input } from '@douyinfe/semi-ui';

import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  config: Record<string, any>;
  saveConfig: (patch: Record<string, any>) => void;
}

export function RuntimeSection({ agent, config, saveConfig }: Props) {
  const piSettings = config.pi_settings || {};

  const [retryEnabled, setRetryEnabled] = useState(piSettings.retry?.enabled ?? true);
  const [maxRetries, setMaxRetries] = useState(piSettings.retry?.maxRetries ?? 3);
  const [compactionEnabled, setCompactionEnabled] = useState(
    piSettings.compaction?.enabled ?? true
  );
  const [httpProxy, setHttpProxy] = useState(piSettings.httpProxy || '');
  const [httpTimeout, setHttpTimeout] = useState(piSettings.httpIdleTimeoutMs ?? 30000);

  useEffect(() => {
    const pi = config.pi_settings || {};
    setRetryEnabled(pi.retry?.enabled ?? true);
    setMaxRetries(pi.retry?.maxRetries ?? 3);
    setCompactionEnabled(pi.compaction?.enabled ?? true);
    setHttpProxy(pi.httpProxy || '');
    setHttpTimeout(pi.httpIdleTimeoutMs ?? 30000);
  }, [agent.id, config]);

  const savePiSettings = (patch: any) => saveConfig({ pi_settings: patch });

  const fieldStyle = { marginBottom: 16 };
  const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 } as const;

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 16 }}>Runtime</h3>
      <div style={fieldStyle}>
        <label style={labelStyle}>Retry</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Switch
            checked={retryEnabled}
            onChange={(v) => {
              setRetryEnabled(v);
              savePiSettings({ retry: { enabled: v } });
            }}
          />
          <InputNumber
            value={maxRetries}
            min={0}
            max={10}
            onChange={(v) => {
              setMaxRetries(v as number);
              savePiSettings({ retry: { maxRetries: v } });
            }}
            style={{ width: 100 }}
          />
          <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>max retries</span>
        </div>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Compaction (context compression)</label>
        <Switch
          checked={compactionEnabled}
          onChange={(v) => {
            setCompactionEnabled(v);
            savePiSettings({ compaction: { enabled: v } });
          }}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>HTTP Proxy</label>
        <Input
          value={httpProxy}
          onChange={setHttpProxy}
          onBlur={() => savePiSettings({ httpProxy: httpProxy || null })}
          placeholder="http://proxy:8080 (optional)"
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>HTTP Idle Timeout (ms)</label>
        <InputNumber
          value={httpTimeout}
          min={1000}
          step={5000}
          onChange={(v) => {
            setHttpTimeout(v as number);
            savePiSettings({ httpIdleTimeoutMs: v });
          }}
          style={{ width: 160 }}
        />
      </div>
    </div>
  );
}
