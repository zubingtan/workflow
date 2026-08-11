import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import {
  ArrowLeft as IconArrowLeft,
  ArrowRight as IconArrowRight,
  Bot as IconBot,
  Search as IconSearch,
  Plus as IconPlus,
  Download as IconDownload,
  Upload as IconUpload,
  Trash2 as IconDelete,
} from 'lucide-react';

import {
  Input,
  Button,
  Empty,
  Spin,
  Tag,
  Toast,
  Typography,
  Select,
  Modal,
  Popconfirm,
} from '../ui/management';
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
  { key: 'general', label: 'General' },
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
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [importState, setImportState] = useState<{
    visible: boolean;
    conflicts: string[];
    missingSkills: string[];
    agents: any[];
    total: number;
  }>({ visible: false, conflicts: [], missingSkills: [], agents: [], total: 0 });
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
        if (result.conflicts.length > 0 || (result.missing_skills ?? []).length > 0) {
          setImportState({
            visible: true,
            conflicts: result.conflicts,
            missingSkills: result.missing_skills ?? [],
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

  /**
   * Confirm the import. `missingStrategy` decides what happens to skill names
   * that do not exist in the library: 'keep' imports them as-is (the skills
   * stay referenced but will not load until created), 'remove' strips them
   * from the imported agent configs (#307).
   */
  const handleImportConfirm = useCallback(
    async (
      strategy: 'skip' | 'overwrite' | 'rename',
      missingStrategy: 'keep' | 'remove' = 'keep'
    ) => {
      try {
        let agents = importState.agents;
        if (missingStrategy === 'remove' && importState.missingSkills.length > 0) {
          const missing = new Set(importState.missingSkills);
          agents = agents.map((item) => {
            const config =
              typeof item.config === 'string' ? JSON.parse(item.config) : { ...item.config };
            const skills = config?.pi_settings?.skills;
            if (Array.isArray(skills)) {
              const kept = skills.filter((s) => !missing.has(s));
              if (kept.length !== skills.length) {
                config.pi_settings = { ...(config.pi_settings || {}), skills: kept };
                return { ...item, config };
              }
            }
            return item;
          });
        }
        const result = await api.importAgentsConfirm(agents, strategy);
        Toast.success(
          `Created: ${result.created}, Skipped: ${result.skipped}, Overwritten: ${result.overwritten}`
        );
        setImportState({ visible: false, conflicts: [], missingSkills: [], agents: [], total: 0 });
        reload();
      } catch (err: any) {
        Toast.error(err?.message || 'Import confirm failed');
      }
    },
    [importState.agents, importState.missingSkills, reload]
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
            color: 'var(--destructive)',
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

  if (!selectedAgent) {
    return (
      <div
        style={{ minHeight: '100%', maxWidth: 1120, margin: '0 auto', padding: '28px 24px 40px' }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 20,
            marginBottom: 24,
          }}
        >
          <div>
            <Typography.Title heading={3} style={{ margin: 0 }}>
              Agents
            </Typography.Title>
            <Typography.Paragraph type="tertiary" style={{ margin: '6px 0 0' }}>
              Configure reusable agents and their runtime behavior.
            </Typography.Paragraph>
          </div>
          <Button icon={<IconPlus />} theme="solid" onClick={handleCreate}>
            New agent
          </Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Input
            prefix={<IconSearch />}
            placeholder="Search agents"
            value={search}
            onChange={setSearch}
            showClear
            style={{ maxWidth: 320 }}
          />
          <Typography.Text type="tertiary" size="small">
            {filtered.length} agents
          </Typography.Text>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <Button size="small" icon={<IconUpload />} onClick={handleImport}>
              Import
            </Button>
            <Button size="small" icon={<IconDownload />} onClick={handleExportAll}>
              Export
            </Button>
          </div>
        </div>
        {allTags.length > 0 && (
          <Select
            placeholder="Filter by tag"
            value={tagFilter ?? ''}
            onChange={(v) => setTagFilter(v === '' ? null : (v as string))}
            showClear
            size="small"
            style={{ marginBottom: 14 }}
          >
            <Select.Option value="">All tags</Select.Option>
            {allTags.map((tag) => (
              <Select.Option key={tag} value={tag}>
                {tag}
              </Select.Option>
            ))}
          </Select>
        )}
        <div
          aria-label="Agent list"
          style={{
            overflow: 'hidden',
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--card)',
          }}
        >
          {loading ? (
            <Spin style={{ display: 'block', margin: 48 }} />
          ) : filtered.length === 0 ? (
            <Empty description="No agents" />
          ) : (
            filtered.map((item) => {
              let tags: string[] = [];
              try {
                tags = JSON.parse(item.tags || '[]');
              } catch {
                tags = [];
              }
              const model = parseAgentConfig(item.config)?.provider?.model || 'OpenAI-compatible';
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    minHeight: 78,
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 36,
                      height: 36,
                      flexShrink: 0,
                      borderRadius: 12,
                      background: 'var(--muted)',
                      color: 'var(--primary)',
                    }}
                  >
                    <IconBot size={18} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <Button
                      theme="borderless"
                      onClick={() => navigate(item.id, 'general')}
                      style={{
                        height: 'auto',
                        padding: 0,
                        fontWeight: 600,
                        color: 'var(--foreground)',
                      }}
                    >
                      {item.name}
                    </Button>
                    <Typography.Text
                      type="tertiary"
                      size="small"
                      style={{ display: 'block', marginTop: 4 }}
                    >
                      {model}
                      {tags[0] ? ` · ${tags[0]}` : ''}
                    </Typography.Text>
                  </div>
                  <Button size="small" onClick={() => navigate(item.id, 'general')}>
                    Open <IconArrowRight />
                  </Button>
                  <Popconfirm
                    title={`Delete "${item.name}"?`}
                    content="Execution history will also be deleted."
                    onConfirm={() => void handleDelete(item.id)}
                  >
                    <Button
                      icon={<IconDelete />}
                      size="small"
                      theme="borderless"
                      type="danger"
                      aria-label={`Delete ${item.name}`}
                    />
                  </Popconfirm>
                </div>
              );
            })
          )}
        </div>
        <Modal
          title="Import Conflicts"
          visible={importState.visible}
          onCancel={() =>
            setImportState({
              visible: false,
              conflicts: [],
              missingSkills: [],
              agents: [],
              total: 0,
            })
          }
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

  const selectedModel =
    parseAgentConfig(selectedAgent.config)?.provider?.model || 'OpenAI-compatible';
  return (
    <div style={{ position: 'relative', minHeight: '100%', overflow: 'auto' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 24px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Button theme="borderless" size="small" onClick={() => navigate(null)}>
            <IconArrowLeft /> Agents
          </Button>
          <span style={{ color: 'var(--muted-foreground)' }}>/</span>
          <Typography.Text type="tertiary" size="small">
            {selectedAgent.name}
          </Typography.Text>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: 14,
              background: 'var(--muted)',
              color: 'var(--primary)',
            }}
          >
            <IconBot size={21} />
          </div>
          <div style={{ minWidth: 0 }}>
            <Typography.Title heading={3} style={{ margin: 0 }}>
              {selectedAgent.name}
            </Typography.Title>
            <Typography.Text type="tertiary" size="small">
              {selectedModel} · Active configuration
            </Typography.Text>
          </div>
          <Tag color="green" style={{ marginLeft: 'auto' }}>
            Configured
          </Tag>
        </div>
        <nav
          aria-label="Agent sections"
          style={{
            display: 'flex',
            gap: 4,
            overflowX: 'auto',
            borderBottom: '1px solid var(--border)',
            marginBottom: 24,
          }}
        >
          {SECTIONS.map((section) => (
            <Button
              key={section.key}
              theme={activeSection === section.key ? 'light' : 'borderless'}
              size="small"
              onClick={() => navigate(selectedAgent.id, section.key)}
              style={{ flexShrink: 0, borderRadius: '8px 8px 0 0' }}
            >
              {section.label}
            </Button>
          ))}
        </nav>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 4px' }}>{renderSection()}</div>
      </div>
      {selectedExecutionId && (
        <div
          style={{
            position: 'absolute',
            zIndex: 4,
            top: 16,
            right: 16,
            bottom: 16,
            width: 'min(380px, calc(100% - 32px))',
            overflow: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--card)',
            boxShadow: 'var(--app-shadow-lg)',
          }}
        >
          <SessionDetailPanel
            agent={selectedAgent}
            executionId={selectedExecutionId}
            onClose={() => setSelectedExecutionId(null)}
            onRerun={handleRerun}
          />
        </div>
      )}
      <Modal
        title="Import Conflicts"
        visible={importState.visible}
        onCancel={() =>
          setImportState({ visible: false, conflicts: [], missingSkills: [], agents: [], total: 0 })
        }
        footer={null}
      >
        {importState.conflicts.length > 0 && (
          <>
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
          </>
        )}
        {importState.missingSkills.length > 0 && (
          <>
            <p>
              These skills are referenced by the imported agents but missing from the library (they
              will not load until created in Settings):
            </p>
            <div style={{ marginBottom: 16 }}>
              {importState.missingSkills.map((name) => (
                <Tag key={name} color="red" style={{ margin: 2 }}>
                  {name}
                </Tag>
              ))}
            </div>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {importState.conflicts.length > 0 && (
            <>
              <Button onClick={() => handleImportConfirm('skip')}>Skip conflicts</Button>
              <Button onClick={() => handleImportConfirm('overwrite')}>Overwrite existing</Button>
              <Button theme="solid" onClick={() => handleImportConfirm('rename')}>
                Rename new
              </Button>
            </>
          )}
          {importState.missingSkills.length > 0 && importState.conflicts.length === 0 && (
            <>
              <Button onClick={() => handleImportConfirm('skip', 'keep')}>Keep references</Button>
              <Button theme="solid" onClick={() => handleImportConfirm('skip', 'remove')}>
                Remove missing skill refs
              </Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
