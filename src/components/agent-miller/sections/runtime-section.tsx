import { useMemo, useEffect, useState } from 'react';

import { Select, InputNumber, Switch, Input } from '@douyinfe/semi-ui';

import type { AgentDef } from '../../../api';

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

interface Props {
  agent: AgentDef;
  debouncedSave: (id: string, patch: any) => void;
  reload: () => void;
}

export function RuntimeSection({ agent, debouncedSave }: Props) {
  const config = useMemo(() => {
    try {
      return JSON.parse(agent.config);
    } catch {
      return {};
    }
  }, [agent.config]);
  const sessionOpts = config.session_options || {};
  const piSettings = config.pi_settings || {};

  const [thinkingLevel, setThinkingLevel] = useState(sessionOpts.thinkingLevel || '');
  const [retryEnabled, setRetryEnabled] = useState(piSettings.retry?.enabled ?? true);
  const [maxRetries, setMaxRetries] = useState(piSettings.retry?.maxRetries ?? 3);
  const [compactionEnabled, setCompactionEnabled] = useState(
    piSettings.compaction?.enabled ?? true
  );
  const [httpProxy, setHttpProxy] = useState(piSettings.httpProxy || '');
  const [httpTimeout, setHttpTimeout] = useState(piSettings.httpIdleTimeoutMs ?? 30000);

  useEffect(() => {
    const cfg = (() => {
      try {
        return JSON.parse(agent.config);
      } catch {
        return {};
      }
    })();
    const opts = cfg.session_options || {};
    const pi = cfg.pi_settings || {};
    setThinkingLevel(opts.thinkingLevel || '');
    setRetryEnabled(pi.retry?.enabled ?? true);
    setMaxRetries(pi.retry?.maxRetries ?? 3);
    setCompactionEnabled(pi.compaction?.enabled ?? true);
    setHttpProxy(pi.httpProxy || '');
    setHttpTimeout(pi.httpIdleTimeoutMs ?? 30000);
  }, [agent.id, agent.config]);

  const saveSessionOpts = (patch: any) =>
    debouncedSave(agent.id, { config: { session_options: { ...sessionOpts, ...patch } } });
  const savePiSettings = (patch: any) =>
    debouncedSave(agent.id, { config: { pi_settings: { ...piSettings, ...patch } } });

  const fieldStyle = { marginBottom: 16 };
  const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 } as const;

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 16 }}>Runtime</h3>
      <div style={fieldStyle}>
        <label style={labelStyle}>Thinking Level</label>
        <Select
          value={thinkingLevel}
          onChange={(v) => {
            setThinkingLevel(v as string);
            saveSessionOpts({ thinkingLevel: v || undefined });
          }}
          placeholder="Default (medium)"
          style={{ width: 200 }}
        >
          {THINKING_LEVELS.map((l) => (
            <Select.Option key={l} value={l}>
              {l}
            </Select.Option>
          ))}
        </Select>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Retry</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Switch
            checked={retryEnabled}
            onChange={(v) => {
              setRetryEnabled(v);
              savePiSettings({ retry: { ...piSettings.retry, enabled: v } });
            }}
          />
          <InputNumber
            value={maxRetries}
            min={0}
            max={10}
            onChange={(v) => {
              setMaxRetries(v as number);
              savePiSettings({ retry: { ...piSettings.retry, maxRetries: v } });
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
            savePiSettings({ compaction: { ...piSettings.compaction, enabled: v } });
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
