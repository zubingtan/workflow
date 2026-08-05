import { useEffect, useState } from 'react';

import { Checkbox, CheckboxGroup, Typography, Select, Radio, RadioGroup } from '@douyinfe/semi-ui';

import type { AgentDef } from '../../../api';

const BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

interface Props {
  agent: AgentDef;
  config: Record<string, any>;
  saveConfig: (patch: Record<string, any>) => void;
}

export function ToolsSection({ agent, config, saveConfig }: Props) {
  const sessionOpts = config.session_options || {};
  const hasBlacklist =
    Array.isArray(sessionOpts.excludeTools) && sessionOpts.excludeTools.length > 0;
  const [mode, setMode] = useState<'whitelist' | 'blacklist'>(
    hasBlacklist ? 'blacklist' : 'whitelist'
  );
  const [tools, setTools] = useState<string[]>(sessionOpts.tools || BUILTIN_TOOLS.slice(0, 4));
  const [excludeTools, setExcludeTools] = useState<string[]>(sessionOpts.excludeTools || []);
  const [noTools, setNoTools] = useState<string>(sessionOpts.noTools || '');

  useEffect(() => {
    const opts = config.session_options || {};
    setTools(opts.tools || BUILTIN_TOOLS.slice(0, 4));
    setExcludeTools(opts.excludeTools || []);
    setNoTools(opts.noTools || '');
    setMode(
      Array.isArray(opts.excludeTools) && opts.excludeTools.length > 0 ? 'blacklist' : 'whitelist'
    );
  }, [agent.id, config]);

  const save = (patch: any) => {
    saveConfig({ session_options: patch });
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

      <RadioGroup
        type="button"
        value={mode}
        onChange={(e) => {
          const m = e.target.value as 'whitelist' | 'blacklist';
          setMode(m);
          if (m === 'whitelist') {
            save({ tools, excludeTools: [] });
          } else {
            save({ tools: [], excludeTools });
          }
        }}
        style={{ marginBottom: 16 }}
      >
        <Radio value="whitelist">Whitelist (allow only)</Radio>
        <Radio value="blacklist">Blacklist (deny only)</Radio>
      </RadioGroup>

      {mode === 'whitelist' ? (
        <>
          <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>
            Enabled tools (whitelist):
          </Typography.Text>
          <CheckboxGroup
            value={tools}
            onChange={(v) => {
              setTools(v as string[]);
              save({ tools: v, excludeTools: [] });
            }}
            direction="vertical"
          >
            {BUILTIN_TOOLS.map((t) => (
              <Checkbox key={t} value={t}>
                {t}
              </Checkbox>
            ))}
          </CheckboxGroup>
        </>
      ) : (
        <>
          <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8 }}>
            Disabled tools (blacklist):
          </Typography.Text>
          <CheckboxGroup
            value={excludeTools}
            onChange={(v) => {
              setExcludeTools(v as string[]);
              save({ tools: [], excludeTools: v });
            }}
            direction="vertical"
          >
            {BUILTIN_TOOLS.map((t) => (
              <Checkbox key={t} value={t}>
                {t}
              </Checkbox>
            ))}
          </CheckboxGroup>
        </>
      )}
    </div>
  );
}
