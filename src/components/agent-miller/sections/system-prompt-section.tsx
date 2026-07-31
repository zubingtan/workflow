import { useState, useEffect, useMemo } from 'react';

import { TextArea } from '@douyinfe/semi-ui';

import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  debouncedSave: (id: string, patch: any) => void;
  reload: () => void;
}

export function SystemPromptSection({ agent, debouncedSave }: Props) {
  const config = useMemo(() => {
    try {
      return JSON.parse(agent.config);
    } catch {
      return {};
    }
  }, [agent.config]);
  const [value, setValue] = useState(config.system_prompt || '');

  useEffect(() => {
    const cfg = (() => {
      try {
        return JSON.parse(agent.config);
      } catch {
        return {};
      }
    })();
    setValue(cfg.system_prompt || '');
  }, [agent.id, agent.config]);

  return (
    <div style={{ maxWidth: 700 }}>
      <h3 style={{ marginBottom: 16 }}>System Prompt</h3>
      <TextArea
        value={value}
        onChange={setValue}
        onBlur={() => debouncedSave(agent.id, { config: { system_prompt: value } })}
        rows={16}
        placeholder="You are a helpful assistant."
        style={{ fontFamily: 'monospace', fontSize: 13 }}
      />
    </div>
  );
}
