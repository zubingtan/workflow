import { useMemo, useEffect, useState } from 'react';

import { Button, Input, List, Typography, Empty } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';

import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  debouncedSave: (id: string, patch: any) => void;
  reload: () => void;
}

export function SkillsSection({ agent, debouncedSave }: Props) {
  const config = useMemo(() => {
    try {
      return JSON.parse(agent.config);
    } catch {
      return {};
    }
  }, [agent.config]);
  const piSettings = config.pi_settings || {};
  const [paths, setPaths] = useState<string[]>(piSettings.skills || []);
  const [input, setInput] = useState('');

  useEffect(() => {
    const cfg = (() => {
      try {
        return JSON.parse(agent.config);
      } catch {
        return {};
      }
    })();
    setPaths((cfg.pi_settings || {}).skills || []);
  }, [agent.id, agent.config]);

  const save = (newPaths: string[]) => {
    setPaths(newPaths);
    debouncedSave(agent.id, { config: { pi_settings: { ...piSettings, skills: newPaths } } });
  };

  const add = () => {
    const p = input.trim();
    if (!p || paths.includes(p)) return;
    save([...paths, p]);
    setInput('');
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 8 }}>Skills</h3>
      <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 16 }}>
        Server filesystem paths to skill directories. Each directory should contain SKILL.md files.
      </Typography.Text>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input value={input} onChange={setInput} onEnterPress={add} placeholder="/path/to/skills" />
        <Button icon={<IconPlus />} onClick={add} theme="solid">
          Add
        </Button>
      </div>
      {paths.length === 0 ? (
        <Empty description="No skill paths configured" />
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
