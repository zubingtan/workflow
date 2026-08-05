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
  Typography,
  Select,
  Modal,
  Popconfirm,
} from '@douyinfe/semi-ui';
import { IconSearch, IconPlus, IconDownload, IconUpload, IconDelete } from '@douyinfe/semi-icons';

import * as api from '../../api';
import { useHashRoute } from './use-hash-route';
import { SessionDetailPanel } from './session-detail';
import { ToolsSection } from './sections/tools-section';
import { SystemPromptSection } from './sections/system-prompt-section';
import { StatsSection } from './sections/stats-section';
import { SkillsSection } from './sections/skills-section';
import { SessionsSection } from './sections/sessions-section';
import { RuntimeSection } from './sections/runtime-section';
import { ProviderSection, type ProviderDraft } from './sections/provider-section';
import { MemoriesSection } from './sections/memories-section';
import { GeneralSection } from './sections/general-section';
import { ExtensionsSection } from './sections/extensions-section';
import { AgentSaveCoordinator, parseAgentConfig } from './agent-config-store.mjs';

const SECTIONS: Array<{ key: string; label: string }> = [
  { key: 'general', label: 'Basic' },
  { key: 'provider', label: 'Provider' },
  { key: 'system-prompt', label: 'System Prompt' },
  { key: 'tools', label: 'Tools' },
  { key: 'runtime', label: 'Runtime' },
  { key: 'skills', label: 'Skills' },
  { key: 'extensions', label: 'Extensions' },
  { key: 'memories', label: 'Memories' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'stats', label: 'Stats' },
];

export type SectionKey = string;

export function AgentMillerColumns() {
  const [agents, setAgents] = useState<api.AgentDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [importState, setImportState] = useState<{
    visible: boolean;
    conflicts: string[];
    agents: any[];
    total: number;
  }>({ visible: false, conflicts: [], agents: [], total: 0 });
  const { route, navigate } = useHashRoute();
  const providerDraftsRef = useRef<Map<string, ProviderDraft>>(new Map());
  const coordinatorRef = useRef<AgentSaveCoordinator | null>(null);
  const [, forceCoordinatorRender] = useState(0);

  if (!coordinatorRef.current) {
    coordinatorRef.current = new AgentSaveCoordinator({
      save: async (id: string, patch: { name?: string; config?: any; tags?: string[] }) => {
        const saved = await api.updateAgent(id, patch);
        setAgents((current) => current.map((agent) => (agent.id === id ? saved : agent)));
        return saved;
      },
    });
  }
  const coordinator = coordinatorRef.current as AgentSaveCoordinator;

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(() => forceCoordinatorRender((value) => value + 1));
    return () => {
      unsubscribe();
      coordinator.dispose();
    };
  }, [coordinator]);

  const syncAgents = useCallback(
    (rows: api.AgentDef[]) => {
      setAgents(rows);
      rows.forEach((agent) => coordinator.seed(agent));
    },
    [coordinator]
  );

  const reload = useCallback(() => {
    api
      .listAgents()
      .then(syncAgents)
      .catch(() => Toast.error('Failed to load agents'));
  }, [syncAgents]);

  useEffect(() => {
    setLoading(true);
    api
      .listAgents()
      .then(syncAgents)
      .catch(() => Toast.error('Failed to load agents'))
      .finally(() => setLoading(false));
  }, [syncAgents]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) {
      try {
        for (const t of JSON.parse(a.tags || '[]')) set.add(t);
      } catch {
        /* skip */
      }
    }
    return Array.from(set).sort();
  }, [agents]);

  const filtered = useMemo(
    () =>
      agents.filter((a) => {
        if (tagFilter) {
          try {
            const tags: string[] = JSON.parse(a.tags || '[]');
            if (!tags.includes(tagFilter)) return false;
          } catch {
            return false;
          }
        }
        if (!search) return true;
        const q = search.toLowerCase();
        if (a.name.toLowerCase().includes(q)) return true;
        try {
          const tags: string[] = JSON.parse(a.tags || '[]');
          return tags.some((t) => t.toLowerCase().includes(q));
        } catch {
          return false;
        }
      }),
    [agents, search, tagFilter]
  );

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === route.agentId) ?? null,
    [agents, route.agentId]
  );

  const activeSection: SectionKey = (route.section as SectionKey) || 'general';

  const handleCreate = useCallback(async () => {
    try {
      const agent = await api.createAgent({});
      reload();
      navigate(agent.id, 'general');
    } catch {
      Toast.error('Failed to create agent');
    }
  }, [reload, navigate]);

  const handleExportAll = useCallback(() => {
    api
      .exportAgents()
      .then((data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'agents-export.json';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => Toast.error('Export failed'));
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const agentsData = JSON.parse(text);
        if (!Array.isArray(agentsData)) throw new Error('Expected JSON array');
        const result = await api.importAgentsPrecheck(agentsData);
        if (result.conflicts.length > 0) {
          setImportState({
            visible: true,
            conflicts: result.conflicts,
            agents: agentsData,
            total: result.total,
          });
        } else {
          await api.importAgentsConfirm(agentsData, 'skip');
          Toast.success(`Imported ${result.importable} agents`);
          reload();
        }
      } catch (err: any) {
        Toast.error(err?.message || 'Import failed');
      }
    };
    input.click();
  }, [reload]);

  const handleImportConfirm = useCallback(
    async (strategy: 'skip' | 'overwrite' | 'rename') => {
      try {
        const result = await api.importAgentsConfirm(importState.agents, strategy);
        Toast.success(
          `Created: ${result.created}, Skipped: ${result.skipped}, Overwritten: ${result.overwritten}`
        );
        setImportState({ visible: false, conflicts: [], agents: [], total: 0 });
        reload();
      } catch (err: any) {
        Toast.error(err?.message || 'Import confirm failed');
      }
    },
    [importState.agents, reload]
  );

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

  /** Central save seam: composes tab patches and serializes per-Agent writes. */
  const debouncedSave = useCallback(
    (id: string, patch: { name?: string; config?: any; tags?: string[] }) => {
      coordinator.update(id, patch);
    },
    [coordinator]
  );

  const saveConfig = useCallback(
    (id: string, patch: Record<string, any>) => debouncedSave(id, { config: patch }),
    [debouncedSave]
  );

  const saveProvider = useCallback(
    (id: string, provider: api.AgentConfig['provider'], testToken: string) =>
      api.saveProvider(id, provider, testToken),
    []
  );

  const handleProviderSaved = useCallback(
    (saved: api.AgentDef) => {
      setAgents((current) => current.map((agent) => (agent.id === saved.id ? saved : agent)));
      coordinator.seed(saved);
    },
    [coordinator]
  );

  const updateProviderDraft = useCallback((id: string, draft: ProviderDraft) => {
    providerDraftsRef.current.set(id, draft);
  }, []);

  const renderSection = () => {
    if (!selectedAgent) {
      return <Empty description="Select an agent to view details" style={{ marginTop: 80 }} />;
    }
    const config = coordinator.getConfig(selectedAgent.id, selectedAgent.config);
    const status = coordinator.getStatus(selectedAgent.id);
    const saveStatus =
      status.state === 'error' ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            color: 'var(--semi-color-danger)',
          }}
        >
          <span>{status.message || 'Save failed'}</span>
          <Button size="small" onClick={() => coordinator.retry(selectedAgent.id)}>
            Retry
          </Button>
        </div>
      ) : status.state === 'saving' || status.state === 'pending' ? (
        <Typography.Text
          type="tertiary"
          size="small"
          style={{ display: 'block', marginBottom: 12 }}
        >
          {status.state === 'saving' ? 'Saving…' : 'Changes pending…'}
        </Typography.Text>
      ) : null;
    switch (activeSection) {
      case 'general':
        return (
          <>
            {saveStatus}
            <GeneralSection
              agent={selectedAgent}
              debouncedSave={debouncedSave}
              draft={coordinator.getDraft(selectedAgent.id)}
            />
          </>
        );
      case 'provider':
        return (
          <>
            {saveStatus}
            <ProviderSection
              agent={selectedAgent}
              config={config}
              drafts={providerDraftsRef.current}
              onDraftChange={updateProviderDraft}
              onSaved={handleProviderSaved}
              saveConfig={(patch) => saveConfig(selectedAgent.id, patch)}
              saveProvider={saveProvider}
            />
          </>
        );
      case 'system-prompt':
        return (
          <>
            {saveStatus}
            <SystemPromptSection
              agent={selectedAgent}
              config={config}
              saveConfig={(patch) => saveConfig(selectedAgent.id, patch)}
            />
          </>
        );
      case 'tools':
        return (
          <>
            {saveStatus}
            <ToolsSection
              agent={selectedAgent}
              config={config}
              saveConfig={(patch) => saveConfig(selectedAgent.id, patch)}
            />
          </>
        );
      case 'runtime':
        return (
          <>
            {saveStatus}
            <RuntimeSection
              agent={selectedAgent}
              config={config}
              saveConfig={(patch) => saveConfig(selectedAgent.id, patch)}
            />
          </>
        );
      case 'skills':
        return (
          <>
            {saveStatus}
            <SkillsSection
              agent={selectedAgent}
              config={config}
              saveConfig={(patch) => saveConfig(selectedAgent.id, patch)}
            />
          </>
        );
      case 'extensions':
        return (
          <>
            {saveStatus}
            <ExtensionsSection
              agent={selectedAgent}
              config={config}
              saveConfig={(patch) => saveConfig(selectedAgent.id, patch)}
            />
          </>
        );
      case 'memories':
        return <MemoriesSection agent={selectedAgent} />;
      case 'sessions':
        return <SessionsSection agent={selectedAgent} onSelectExecution={setSelectedExecutionId} />;
      case 'stats':
        return <StatsSection agent={selectedAgent} />;
      default:
        return <Empty description="Unknown section" />;
    }
  };

  const handleRerun = useCallback(
    (prompt: string) => {
      if (!selectedAgent) return;
      api.runAgentById(selectedAgent.id, prompt).catch(() => Toast.error('Re-run failed'));
      Toast.success('Re-run started');
      setSelectedExecutionId(null);
    },
    [selectedAgent]
  );

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
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                <Button
                  icon={<IconPlus />}
                  theme="solid"
                  onClick={handleCreate}
                  style={{ flex: 1 }}
                >
                  New Agent
                </Button>
                <Button icon={<IconDownload />} onClick={handleExportAll} title="Export all" />
                <Button icon={<IconUpload />} onClick={handleImport} title="Import" />
              </div>
              <Input
                prefix={<IconSearch />}
                placeholder="Search agents..."
                value={search}
                onChange={setSearch}
                showClear
                style={{ marginBottom: 8 }}
              />
              {allTags.length > 0 && (
                <Select
                  placeholder="Filter by tag"
                  value={tagFilter ?? ''}
                  onChange={(v) => setTagFilter(v === '' ? null : (v as string))}
                  showClear
                  size="small"
                >
                  <Select.Option value="">All tags</Select.Option>
                  {allTags.map((t) => (
                    <Select.Option key={t} value={t}>
                      {t}
                    </Select.Option>
                  ))}
                </Select>
              )}
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
                      onMouseEnter={() => setHoveredAgentId(item.id)}
                      onMouseLeave={() => setHoveredAgentId(null)}
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
                            {parseAgentConfig(item.config)?.provider?.model || ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {JSON.parse(item.tags || '[]').length > 0 && (
                            <Tag size="small" color="blue">
                              {JSON.parse(item.tags)[0]}
                            </Tag>
                          )}
                          {hoveredAgentId === item.id && (
                            <Popconfirm
                              title={`Delete "${item.name}"?`}
                              content="Execution history will also be deleted."
                              onConfirm={() => void handleDelete(item.id)}
                              position="right"
                            >
                              <Button
                                icon={<IconDelete />}
                                size="small"
                                theme="borderless"
                                type="danger"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </Popconfirm>
                          )}
                        </div>
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

        {/* Col 5: Session Detail (dynamic, shown when an execution is selected) */}
        {selectedExecutionId && selectedAgent && (
          <>
            <ResizeHandler />
            <ResizeItem defaultSize="350px" min="250px" max="50%">
              <SessionDetailPanel
                agent={selectedAgent}
                executionId={selectedExecutionId}
                onClose={() => setSelectedExecutionId(null)}
                onRerun={handleRerun}
              />
            </ResizeItem>
          </>
        )}
      </ResizeGroup>

      {/* Import conflict dialog */}
      <Modal
        title="Import Conflicts"
        visible={importState.visible}
        onCancel={() => setImportState({ visible: false, conflicts: [], agents: [], total: 0 })}
        footer={null}
      >
        <p>
          {importState.conflicts.length} of {importState.total} agents have name conflicts:
        </p>
        <div style={{ marginBottom: 16 }}>
          {importState.conflicts.map((name) => (
            <Tag key={name} color="orange" style={{ margin: 2 }}>
              {name}
            </Tag>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={() => handleImportConfirm('skip')}>Skip conflicts</Button>
          <Button onClick={() => handleImportConfirm('overwrite')}>Overwrite existing</Button>
          <Button theme="solid" onClick={() => handleImportConfirm('rename')}>
            Rename new
          </Button>
        </div>
      </Modal>
    </div>
  );
}
