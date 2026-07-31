import { useMemo, useEffect, useState } from 'react';

import { Checkbox, CheckboxGroup, Typography, Select } from '@douyinfe/semi-ui';

import type { AgentDef } from '../../../api';

const BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

interface Props {
  agent: AgentDef;
  debouncedSave: (id: string, patch: any) => void;
  reload: () => void;
}

export function ToolsSection({ agent, debouncedSave }: Props) {
  const config = useMemo(() => {
    try {
      return JSON.parse(agent.config);
    } catch {
      return {};
    }
  }, [agent.config]);
  const sessionOpts = config.session_options || {};
  const [tools, setTools] = useState<string[]>(sessionOpts.tools || BUILTIN_TOOLS.slice(0, 4));
  const [noTools, setNoTools] = useState<string>(sessionOpts.noTools || '');

  useEffect(() => {
    const cfg = (() => {
      try {
        return JSON.parse(agent.config);
      } catch {
        return {};
      }
    })();
    const opts = cfg.session_options || {};
    setTools(opts.tools || BUILTIN_TOOLS.slice(0, 4));
    setNoTools(opts.noTools || '');
  }, [agent.id, agent.config]);

  const save = (patch: any) => {
    debouncedSave(agent.id, { config: { session_options: { ...sessionOpts, ...patch } } });
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 16 }}>Tools</h3>
      <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 16 }}>
        Select which built-in tools this agent can use. Default: read, bash, edit, write.
      </Typography.Text>

      <Select
        value={noTools}
        onChange={(v) => {
          setNoTools(v as string);
          save({ noTools: v || null });
        }}
        style={{ width: 240, marginBottom: 16 }}
        placeholder="No suppression"
      >
        <Select.Option value="">No suppression</Select.Option>
        <Select.Option value="all">Disable all tools</Select.Option>
        <Select.Option value="builtin">Disable builtin only</Select.Option>
      </Select>

      <CheckboxGroup
        value={tools}
        onChange={(v) => {
          setTools(v as string[]);
          save({ tools: v });
        }}
        direction="vertical"
      >
        {BUILTIN_TOOLS.map((t) => (
          <Checkbox key={t} value={t}>
            {t}
          </Checkbox>
        ))}
      </CheckboxGroup>
    </div>
  );
}
