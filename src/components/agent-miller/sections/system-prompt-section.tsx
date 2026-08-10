import { useState, useEffect } from 'react';

import { TextArea } from '../../ui/management';
import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  config: Record<string, any>;
  saveConfig: (patch: Record<string, any>) => void;
}

export function SystemPromptSection({ agent, config, saveConfig }: Props) {
  const [value, setValue] = useState(config.system_prompt || '');

  useEffect(() => {
    setValue(config.system_prompt || '');
  }, [agent.id, config]);

  return (
    <div style={{ maxWidth: 700 }}>
      <h3 style={{ marginBottom: 16 }}>System Prompt</h3>
      <TextArea
        value={value}
        onChange={setValue}
        onBlur={() => saveConfig({ system_prompt: value })}
        rows={16}
        placeholder="You are a helpful assistant."
        style={{ fontFamily: 'monospace', fontSize: 13 }}
      />
    </div>
  );
}
