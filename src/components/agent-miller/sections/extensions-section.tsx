import { useMemo, useEffect, useState } from 'react';

import { Button, Input, List, Typography, Empty } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';

import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  debouncedSave: (id: string, patch: any) => void;
  reload: () => void;
}

export function ExtensionsSection({ agent, debouncedSave }: Props) {
  const config = useMemo(() => {
    try {
      return JSON.parse(agent.config);
    } catch {
      return {};
    }
  }, [agent.config]);
  const piSettings = config.pi_settings || {};
  const [paths, setPaths] = useState<string[]>(piSettings.extensions || []);
  const [input, setInput] = useState('');

  useEffect(() => {
    const cfg = (() => {
      try {
        return JSON.parse(agent.config);
      } catch {
        return {};
      }
    })();
    setPaths((cfg.pi_settings || {}).extensions || []);
  }, [agent.id, agent.config]);

  const save = (newPaths: string[]) => {
    setPaths(newPaths);
    debouncedSave(agent.id, { config: { pi_settings: { ...piSettings, extensions: newPaths } } });
  };

  const add = () => {
    const p = input.trim();
    if (!p || paths.includes(p)) return;
    save([...paths, p]);
    setInput('');
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 8 }}>Extensions / MCP</h3>
      <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 16 }}>
        Server filesystem paths to extension directories or MCP server modules.
      </Typography.Text>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={input}
          onChange={setInput}
          onEnterPress={add}
          placeholder="/path/to/extension"
        />
        <Button icon={<IconPlus />} onClick={add} theme="solid">
          Add
        </Button>
      </div>
      {paths.length === 0 ? (
        <Empty description="No extension paths configured" />
      ) : (
        <List
          dataSource={paths}
          renderItem={(p, i) => (
            <List.Item key={i} style={{ padding: '6px 0' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  width: '100%',
                }}
              >
                <code style={{ fontSize: 13 }}>{p}</code>
                <Button
                  icon={<IconDelete />}
                  type="danger"
                  theme="borderless"
                  size="small"
                  onClick={() => save(paths.filter((_, j) => j !== i))}
                />
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
