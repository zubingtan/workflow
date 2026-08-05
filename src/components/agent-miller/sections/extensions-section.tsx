import { useEffect, useState } from 'react';

import { Button, Input, List, Typography, Empty } from '@douyinfe/semi-ui';
import { IconPlus, IconDelete } from '@douyinfe/semi-icons';

import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  config: Record<string, any>;
  saveConfig: (patch: Record<string, any>) => void;
}

export function ExtensionsSection({ agent, config, saveConfig }: Props) {
  const piSettings = config.pi_settings || {};
  const [paths, setPaths] = useState<string[]>(piSettings.extensions || []);
  const [packages, setPackages] = useState<string[]>(piSettings.packages || []);
  const [input, setInput] = useState('');
  const [pkgInput, setPkgInput] = useState('');

  useEffect(() => {
    setPaths((config.pi_settings || {}).extensions || []);
    setPackages((config.pi_settings || {}).packages || []);
  }, [agent.id, config]);

  const save = (newPaths: string[]) => {
    setPaths(newPaths);
    saveConfig({ pi_settings: { extensions: newPaths } });
  };

  const savePackages = (newPkgs: string[]) => {
    setPackages(newPkgs);
    saveConfig({ pi_settings: { packages: newPkgs } });
  };

  const add = () => {
    const p = input.trim();
    if (!p || paths.includes(p)) return;
    save([...paths, p]);
    setInput('');
  };

  const addPkg = () => {
    const p = pkgInput.trim();
    if (!p || packages.includes(p)) return;
    savePackages([...packages, p]);
    setPkgInput('');
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

      <h4 style={{ marginTop: 24, marginBottom: 8 }}>Packages</h4>
      <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 16 }}>
        npm packages or git URLs to load as extension sources.
      </Typography.Text>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          value={pkgInput}
          onChange={setPkgInput}
          onEnterPress={addPkg}
          placeholder="package-name or git-url"
        />
        <Button icon={<IconPlus />} onClick={addPkg} theme="solid">
          Add
        </Button>
      </div>
      {packages.length === 0 ? (
        <Empty description="No packages configured" />
      ) : (
        <List
          dataSource={packages}
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
                  onClick={() => savePackages(packages.filter((_, j) => j !== i))}
                />
              </div>
            </List.Item>
          )}
        />
      )}
    </div>
  );
}
