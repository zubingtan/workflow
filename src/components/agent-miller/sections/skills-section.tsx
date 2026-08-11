import { useEffect, useState } from 'react';

import { AlertTriangle as IconAlertTriangle, Trash2 as IconDelete } from 'lucide-react';

import { List, Switch, Typography, Empty, Button, Tag } from '../../ui/management';
import * as api from '../../../api';
import type { AgentDef } from '../../../api';

interface Props {
  agent: AgentDef;
  config: Record<string, any>;
  saveConfig: (patch: Record<string, any>) => void;
}

/**
 * Skills — global library list with per-agent toggles (#307).
 *
 * An agent's enabled skills are stored by NAME in pi_settings.skills (the
 * server resolves names to library paths at session creation). Entries in the
 * config that do not exist in the library anymore (e.g. the skill was deleted
 * in Settings) render as warning rows that can be removed in one click.
 */
export function SkillsSection({ agent, config, saveConfig }: Props) {
  const [library, setLibrary] = useState<api.SkillSummary[]>([]);
  const [enabled, setEnabled] = useState<string[]>(() => (config.pi_settings || {}).skills || []);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .listSkills()
      .then(setLibrary)
      .catch(() => setLibrary([]))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    setEnabled((config.pi_settings || {}).skills || []);
  }, [agent.id, config]);

  const save = (names: string[]) => {
    setEnabled(names);
    saveConfig({ pi_settings: { skills: names } });
  };

  const toggle = (name: string, checked: boolean) => {
    const next = checked ? [...enabled, name] : enabled.filter((n) => n !== name);
    save(next);
  };

  const libraryNames = new Set(library.map((s) => s.name));
  // Path-like entries (legacy absolute paths, or any name containing a slash)
  // are valid passthroughs for resolveSkillPaths — they are NOT "deleted".
  const isPathEntry = (n: string) => /^[.]|[/\\]/.test(n);
  const missing = enabled.filter((n) => !libraryNames.has(n) && !isPathEntry(n));
  const legacyPaths = enabled.filter((n) => !libraryNames.has(n) && isPathEntry(n));

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginBottom: 8 }}>Skills</h3>
      <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 16 }}>
        Enable skills from the global library (managed in Settings → Skills). Enabled skills are
        injected into this agent's session.
      </Typography.Text>
      {!loaded ? (
        <Empty description="Loading…" />
      ) : library.length === 0 ? (
        <Empty description="No skills in the library yet — create or import one in Settings" />
      ) : (
        <List
          dataSource={library}
          renderItem={(skill) => (
            <List.Item
              key={skill.name}
              style={{ padding: '8px 0' }}
              className="justify-between gap-3"
            >
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong>
                  <code>{skill.name}</code>
                </Typography.Text>
                <Typography.Text
                  type="tertiary"
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {skill.description || '(no description)'}
                </Typography.Text>
              </div>
              <Switch
                checked={enabled.includes(skill.name)}
                onChange={(v) => toggle(skill.name, Boolean(v))}
                className="shrink-0"
              />
            </List.Item>
          )}
        />
      )}
      {missing.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text
            type="danger"
            size="small"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <IconAlertTriangle /> Missing from library
          </Typography.Text>
          <List
            dataSource={missing}
            renderItem={(name) => (
              <List.Item
                key={name}
                style={{ padding: '6px 0', opacity: 0.7 }}
                className="justify-between gap-3"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code>{name}</code>
                  <Tag size="small" color="red">
                    deleted
                  </Tag>
                </div>
                <Button
                  icon={<IconDelete />}
                  type="danger"
                  theme="borderless"
                  size="small"
                  onClick={() => save(enabled.filter((n) => n !== name))}
                />
              </List.Item>
            )}
          />
        </div>
      )}
      {legacyPaths.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text
            type="tertiary"
            size="small"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <IconAlertTriangle /> External skill paths (legacy)
          </Typography.Text>
          <List
            dataSource={legacyPaths}
            renderItem={(name) => (
              <List.Item key={name} style={{ padding: '6px 0', opacity: 0.7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code>{name}</code>
                  <Tag size="small" color="grey">
                    external path
                  </Tag>
                </div>
              </List.Item>
            )}
          />
        </div>
      )}
      {legacyPaths.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text
            type="tertiary"
            size="small"
            style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <IconAlertTriangle /> External skill paths (legacy)
          </Typography.Text>
          <List
            dataSource={legacyPaths}
            renderItem={(name) => (
              <List.Item key={name} style={{ padding: '6px 0', opacity: 0.7 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <code>{name}</code>
                  <Tag size="small" color="grey">
                    external path
                  </Tag>
                </div>
              </List.Item>
            )}
          />
        </div>
      )}
    </div>
  );
}
