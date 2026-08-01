import { useState, useEffect, useMemo } from 'react';

import { Input, Button, Tag, Toast } from '@douyinfe/semi-ui';

import * as api from '../../../api';
import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  debouncedSave: (id: string, patch: any) => void;
  reload: () => void;
}

export function GeneralSection({ agent, debouncedSave, reload }: Props) {
  const config = useMemo(() => {
    try {
      return JSON.parse(agent.config);
    } catch {
      return {};
    }
  }, [agent.config]);
  const tags: string[] = useMemo(() => {
    try {
      return JSON.parse(agent.tags || '[]');
    } catch {
      return [];
    }
  }, [agent.tags]);

  const [name, setName] = useState(agent.name);
  const [baseUrl, setBaseUrl] = useState(config.provider?.base_url || '');
  const [apiKey, setApiKey] = useState(config.provider?.api_key || '');
  const [model, setModel] = useState(config.provider?.model || '');
  const [tagInput, setTagInput] = useState('');
  const [pricing, setPricing] = useState({
    input: config.provider?.pricing?.input ?? 0,
    output: config.provider?.pricing?.output ?? 0,
    cacheRead: config.provider?.pricing?.cacheRead ?? 0,
    cacheWrite: config.provider?.pricing?.cacheWrite ?? 0,
  });

  useEffect(() => {
    setName(agent.name);
    const cfg = (() => {
      try {
        return JSON.parse(agent.config);
      } catch {
        return {};
      }
    })();
    setBaseUrl(cfg.provider?.base_url || '');
    setApiKey(cfg.provider?.api_key || '');
    setModel(cfg.provider?.model || '');
    setPricing({
      input: cfg.provider?.pricing?.input ?? 0,
      output: cfg.provider?.pricing?.output ?? 0,
      cacheRead: cfg.provider?.pricing?.cacheRead ?? 0,
      cacheWrite: cfg.provider?.pricing?.cacheWrite ?? 0,
    });
  }, [agent.id, agent.config, agent.name]);

  const saveProvider = (patch: Record<string, any>) => {
    debouncedSave(agent.id, { config: { provider: { ...config.provider, ...patch } } });
  };

  const savePricing = (key: string, value: number) => {
    const newPricing = { ...pricing, [key]: value };
    setPricing(newPricing);
    saveProvider({ pricing: newPricing });
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tags.includes(t)) return;
    const newTags = [...tags, t];
    api
      .updateAgent(agent.id, { tags: newTags })
      .then(reload)
      .catch(() => Toast.error('Failed'));
    setTagInput('');
  };

  const removeTag = (t: string) => {
    const newTags = tags.filter((x) => x !== t);
    api
      .updateAgent(agent.id, { tags: newTags })
      .then(reload)
      .catch(() => Toast.error('Failed'));
  };

  const fieldStyle = { marginBottom: 16 };
  const labelStyle = { display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 } as const;

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 16 }}>General</h3>
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor="agent-name">
          Name
        </label>
        <Input
          id="agent-name"
          value={name}
          onChange={setName}
          onBlur={() => {
            if (name !== agent.name) debouncedSave(agent.id, { name });
          }}
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Provider Base URL</label>
        <Input
          value={baseUrl}
          onChange={setBaseUrl}
          onBlur={() => saveProvider({ base_url: baseUrl })}
          placeholder="https://api.openai.com/v1"
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>API Key</label>
        <Input
          mode="password"
          value={apiKey}
          onChange={setApiKey}
          onBlur={() => saveProvider({ api_key: apiKey })}
        />
        <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>
          Supports $ENV_VAR format
        </span>
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>Model</label>
        <Input
          value={model}
          onChange={setModel}
          onBlur={() => saveProvider({ model })}
          placeholder="gpt-4o"
        />
      </div>

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>Pricing ($/M tokens)</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((key) => (
          <div key={key}>
            <label style={{ ...labelStyle, textTransform: 'capitalize' }}>{key}</label>
            <Input
              type="number"
              size="small"
              value={String(pricing[key])}
              onChange={(v) => savePricing(key, Number(v) || 0)}
            />
          </div>
        ))}
      </div>

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>Tags</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {tags.map((t) => (
          <Tag key={t} closable onClose={() => removeTag(t)} color="blue">
            {t}
          </Tag>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          size="small"
          value={tagInput}
          onChange={setTagInput}
          placeholder="Add tag..."
          onEnterPress={addTag}
          style={{ width: 160 }}
        />
        <Button size="small" onClick={addTag}>
          Add
        </Button>
      </div>
    </div>
  );
}
