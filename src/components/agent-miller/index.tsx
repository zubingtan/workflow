import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import {
  ResizeGroup,
  ResizeItem,
  ResizeHandler,
  Input,
  List,
  Button,
  Empty,
  Spin,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import { IconSearch, IconPlus } from '@douyinfe/semi-icons';

import * as api from '../../api';
import { useHashRoute } from './use-hash-route';
import { ToolsSection } from './sections/tools-section';
import { SystemPromptSection } from './sections/system-prompt-section';
import { StatsSection } from './sections/stats-section';
import { SkillsSection } from './sections/skills-section';
import { SessionsSection } from './sections/sessions-section';
import { RuntimeSection } from './sections/runtime-section';
import { GeneralSection } from './sections/general-section';
import { ExtensionsSection } from './sections/extensions-section';

const SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'general', label: 'General' },
  { key: 'system-prompt', label: 'System Prompt' },
  { key: 'tools', label: 'Tools' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'skills', label: 'Skills' },
  { key: 'extensions', label: 'Extensions' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'stats', label: 'Stats' },
];

export type SectionKey = string;

export function AgentMillerColumns() {
  const [agents, setAgents] = useState<api.AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { route, navigate } = useHashRoute();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    api
      .listAgents()
      .then(setAgents)
      .catch(() => Toast.error('Failed to load agents'));
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .listAgents()
      .then(setAgents)
      .catch(() => Toast.error('Failed to load agents'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => agents.filter((a) => a.name.toLowerCase().includes(search.toLowerCase())),
    [agents, search]
  );

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === route.agentId) ?? null,
    [agents, route.agentId]
  );

  const activeSection: SectionKey = (route.section as SectionKey) || 'general';

  const handleCreate = useCallback(async () => {
    try {
      const agent = await api.createAgent({ name: 'Untitled' });
      reload();
      navigate(agent.id, 'general');
    } catch {
      Toast.error('Failed to create agent');
    }
  }, [reload, navigate]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteAgent(id);
        reload();
        if (route.agentId === id) navigate(null);
      } catch (err: any) {
        Toast.error(err.message || 'Failed to delete agent');
      }
    },
    [reload, navigate, route.agentId]
  );
  void handleDelete; // used in future context menu

  /** Debounced save for inline editing */
  const debouncedSave = useCallback(
    (id: string, patch: { name?: string; config?: any; tags?: string[] }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await api.updateAgent(id, patch);
          reload();
        } catch {
          Toast.error('Save failed');
        }
      }, 600);
    },
    [reload]
  );

  const renderSection = () => {
    if (!selectedAgent) {
      return <Empty description="Select an agent to view details" style={{ marginTop: 80 }} />;
    }
    const props = { agent: selectedAgent, debouncedSave, reload };
    switch (activeSection) {
      case 'general':
        return <GeneralSection {...props} />;
      case 'system-prompt':
        return <SystemPromptSection {...props} />;
      case 'tools':
        return <ToolsSection {...props} />;
      case 'runtime':
        return <RuntimeSection {...props} />;
      case 'skills':
        return <SkillsSection {...props} />;
      case 'extensions':
        return <ExtensionsSection {...props} />;
      case 'sessions':
        return <SessionsSection agent={selectedAgent} />;
      case 'stats':
        return <StatsSection agent={selectedAgent} />;
      default:
        return <Empty description="Unknown section" />;
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex' }}>
      <ResizeGroup direction="horizontal">
        {/* Col 2: Agent List */}
        <ResizeItem defaultSize="250px" min="180px" max="35%">
          <div
            style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div
              style={{
                padding: 12,
                borderBottom: '1px solid var(--semi-color-border)',
                flexShrink: 0,
              }}
            >
              <Button
                icon={<IconPlus />}
                theme="solid"
                block
                onClick={handleCreate}
                style={{ marginBottom: 8 }}
              >
                New Agent
              </Button>
              <Input
                prefix={<IconSearch />}
                placeholder="Search agents..."
                value={search}
                onChange={setSearch}
                showClear
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              {loading ? (
                <Spin style={{ display: 'block', margin: '40px auto' }} />
              ) : filtered.length === 0 ? (
                <Empty description="No agents" />
              ) : (
                <List
                  dataSource={filtered}
                  renderItem={(item) => (
                    <List.Item
                      key={item.id}
                      onClick={() => navigate(item.id, activeSection)}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 12px',
                        background:
                          selectedAgent?.id === item.id
                            ? 'var(--semi-color-fill-0)'
                            : 'transparent',
                        borderLeft:
                          selectedAgent?.id === item.id
                            ? '3px solid var(--semi-color-primary)'
                            : '3px solid transparent',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          width: '100%',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 500 }}>{item.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                            {(() => {
                              try {
                                return JSON.parse(item.config)?.provider?.model || '';
                              } catch {
                                return '';
                              }
                            })()}
                          </div>
                        </div>
                        {JSON.parse(item.tags || '[]').length > 0 && (
                          <Tag size="small" color="blue">
                            {JSON.parse(item.tags)[0]}
                          </Tag>
                        )}
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </div>
          </div>
        </ResizeItem>

        <ResizeHandler />

        {/* Col 3: Section Nav */}
        <ResizeItem defaultSize="160px" min="120px" max="20%">
          <div
            style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          >
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', minHeight: 0 }}>
              <List
                dataSource={SECTIONS}
                renderItem={(s) => (
                  <List.Item
                    key={s.key}
                    onClick={() => selectedAgent && navigate(selectedAgent.id, s.key)}
                    style={{
                      cursor: selectedAgent ? 'pointer' : 'default',
                      padding: '8px 16px',
                      opacity: selectedAgent ? 1 : 0.4,
                      background:
                        activeSection === s.key && selectedAgent
                          ? 'var(--semi-color-fill-0)'
                          : 'transparent',
                      fontWeight: activeSection === s.key && selectedAgent ? 600 : 400,
                    }}
                  >
                    {s.label}
                  </List.Item>
                )}
              />
            </div>
          </div>
        </ResizeItem>

        <ResizeHandler />

        {/* Col 4: Content Area */}
        <ResizeItem defaultSize="1" min="30%">
          <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>{renderSection()}</div>
        </ResizeItem>
      </ResizeGroup>
    </div>
  );
}
