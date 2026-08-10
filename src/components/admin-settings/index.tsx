import { useCallback, useEffect, useState } from 'react';

import {
  Archive,
  CheckCircle2 as IconTickCircle,
  Clock3,
  Database,
  Layers,
  Pencil as IconEdit,
  Plus as IconPlus,
  RefreshCw,
  Trash2 as IconDelete,
  X as IconClose,
} from 'lucide-react';

import {
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Typography,
  Spin,
  Toast,
  Tag,
} from '../ui/management';
import * as api from '../../api';
import { SkillEditor } from './skill-editor';

/**
 * Phase 9 (#161): Admin settings page.
 *
 * Edits the global `node_timeout_default_ms` — the per-node execution timeout
 * fallback when a node has no `node.data.timeoutOverride`. Stored in the
 * `settings` table (Phase 1). Per-node overrides live in the node form.
 *
 * T3 (#215): mem0 memory server connection settings (host + API key).
 * Follow-up: mem0 admin key + LLM/embedding provider config pushed to the
 * mem0 server via POST /configure, plus a one-click end-to-end Test button.
 *
 * Validation mirrors the server (server/settings.mjs). The server is the
 * source of truth — client validation is advisory.
 */
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const SETTINGS_NAV = [
  {
    id: 'execution',
    label: 'Execution',
    description: 'Default workflow run limits.',
    icon: Clock3,
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Persistent memory and retrieval models.',
    icon: Database,
  },
  {
    id: 'local-data',
    label: 'Local data',
    description: 'Storage location and access.',
    icon: Archive,
  },
  {
    id: 'skills',
    label: 'Skills',
    description: 'Global skill library (SKILL.md folders agents can enable).',
    icon: Layers,
  },
];

export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [value, setValue] = useState<number | null>(null);
  const [mem0Host, setMem0Host] = useState<string>('');
  const [mem0ApiKey, setMem0ApiKey] = useState<string>('');
  const [mem0AdminKey, setMem0AdminKey] = useState<string>('');
  const [llmBaseUrl, setLlmBaseUrl] = useState<string>('');
  const [llmModel, setLlmModel] = useState<string>('');
  const [embedderModel, setEmbedderModel] = useState<string>('');
  const [embeddingDims, setEmbeddingDims] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<api.Mem0TestResponse | null>(null);
  const [activeSection, setActiveSection] = useState('execution');
  const [skills, setSkills] = useState<api.SkillSummary[]>([]);
  const [editorState, setEditorState] = useState<
    { mode: 'new' } | { mode: 'edit'; name: string } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<api.SkillSummary | null>(null);
  const [deleteBlockedBy, setDeleteBlockedBy] = useState<string[] | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    api
      .getSettings()
      .then((s) => {
        setValue(s.node_timeout_default_ms);
        setMem0Host(s.mem0_host ?? '');
        setMem0ApiKey(s.mem0_api_key ?? '');
        setMem0AdminKey(s.mem0_admin_key ?? '');
        setLlmBaseUrl(s.mem0_llm_base_url ?? '');
        setLlmModel(s.mem0_llm_model ?? '');
        setEmbedderModel(s.mem0_embedder_model ?? '');
        setEmbeddingDims(s.mem0_embedding_dims);
      })
      .catch((err) => {
        Toast.error(err instanceof Error ? err.message : 'Failed to load settings');
      })
      .finally(() => setLoading(false));
    api
      .listSkills()
      .then(setSkills)
      .catch(() => setSkills([]));
  }, []);

  useEffect(() => reload(), [reload]);

  const save = async () => {
    if (value != null && (!Number.isInteger(value) || value <= 0)) {
      Toast.error('Must be a positive integer');
      return;
    }
    if (value != null && value > MAX_TIMEOUT_MS) {
      Toast.error(`Cannot exceed 24 hours (${MAX_TIMEOUT_MS} ms)`);
      return;
    }
    setSaving(true);
    try {
      const patch: Partial<api.AppSettings> = {
        // null clears the timeout setting (mem0-only setups leave it empty).
        node_timeout_default_ms: value,
        // Send trimmed value or null (null clears the setting on the server).
        mem0_host: mem0Host.trim() || null,
        mem0_api_key: mem0ApiKey.trim() || null,
        mem0_admin_key: mem0AdminKey.trim() || null,
        mem0_llm_base_url: llmBaseUrl.trim() || null,
        mem0_llm_model: llmModel.trim() || null,
        mem0_embedder_model: embedderModel.trim() || null,
        mem0_embedding_dims: embeddingDims,
      };
      await api.updateSettings(patch);

      // Push LLM/embedding config to the mem0 server (requires admin key).
      if (
        patch.mem0_host &&
        (patch.mem0_llm_model || patch.mem0_embedder_model || patch.mem0_llm_base_url)
      ) {
        const cfgResult = await api.configureMem0({
          llm_base_url: patch.mem0_llm_base_url,
          llm_model: patch.mem0_llm_model,
          embedder_model: patch.mem0_embedder_model,
          embedding_dims: patch.mem0_embedding_dims,
        });
        if (!cfgResult.ok) {
          Toast.warning(
            `Saved, but mem0 configure failed: ${cfgResult.error ?? `HTTP ${cfgResult.status}`}`
          );
        } else {
          Toast.success('Saved');
        }
      } else {
        Toast.success('Saved');
      }
      reload();
    } catch (err: any) {
      Toast.error(err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (!mem0Host.trim() || !mem0ApiKey.trim()) {
      Toast.warning('Please fill in mem0 Server URL and API Key first');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // Ensure the settings are persisted first so the backend proxy can read them.
      await api.updateSettings({
        mem0_host: mem0Host.trim(),
        mem0_api_key: mem0ApiKey.trim(),
        mem0_admin_key: mem0AdminKey.trim() || null,
      });
      const result = await api.testMem0();
      setTestResult(result);
      if (result.ok) {
        Toast.success('mem0 test passed');
      } else {
        Toast.error('mem0 test failed — see details below');
      }
    } catch (err: any) {
      Toast.error(err?.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteSkill = async (skill: api.SkillSummary) => {
    try {
      const refs = await api.getSkillReferences(skill.name);
      setDeleteBlockedBy(refs.referencedBy.length > 0 ? refs.referencedBy : null);
      setDeleteTarget(skill);
    } catch (err: any) {
      Toast.error(err?.message || 'Failed to check skill references');
    }
  };

  const confirmDeleteSkill = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteSkill(deleteTarget.name);
      Toast.success(`Deleted "${deleteTarget.name}"`);
      setDeleteTarget(null);
      setDeleteBlockedBy(null);
      reload();
    } catch (err: any) {
      Toast.error(err?.message || 'Delete failed');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  const activeSettings = SETTINGS_NAV.find((item) => item.id === activeSection) ?? SETTINGS_NAV[0];

  const field = (label: string, control: React.ReactNode, description?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Typography.Text size="small" strong>
        {label}
      </Typography.Text>
      {control}
      {description && (
        <Typography.Text type="tertiary" size="small">
          {description}
        </Typography.Text>
      )}
    </label>
  );

  const memoryCard = (
    <Card style={{ overflow: 'hidden', boxShadow: 'none' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          padding: '16px 18px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 32,
            height: 32,
            borderRadius: 10,
            background: 'var(--muted)',
            color: 'var(--primary)',
          }}
        >
          <Database size={17} />
        </div>
        <div>
          <Typography.Title heading={5} style={{ margin: 0 }}>
            Memory (mem0)
          </Typography.Title>
          <Typography.Paragraph type="tertiary" size="small" style={{ margin: '4px 0 0' }}>
            Configure persistent Agent memory and the models used to extract and search it.
          </Typography.Paragraph>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 16, padding: 18 }}>
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          }}
        >
          {field(
            'Server URL',
            <Input value={mem0Host} onChange={setMem0Host} placeholder="http://localhost:8890" />
          )}
          {field(
            'API key',
            <Input
              value={mem0ApiKey}
              onChange={setMem0ApiKey}
              placeholder="API key"
              mode="password"
            />
          )}
          {field(
            'Admin key',
            <Input
              value={mem0AdminKey}
              onChange={setMem0AdminKey}
              placeholder="Optional admin key"
              mode="password"
            />
          )}
          {field(
            'LLM base URL',
            <div style={{ display: 'flex', gap: 6 }}>
              <Input
                value={llmBaseUrl}
                onChange={setLlmBaseUrl}
                placeholder="https://api.example.com/v1"
                style={{ flex: 1 }}
              />
              <Button
                size="small"
                aria-label="Refresh memory models"
                icon={<RefreshCw className={testing ? 'animate-spin' : undefined} />}
                onClick={() => Toast.info('Models are discovered by the configured mem0 provider')}
              />
            </div>,
            'OpenAI-compatible endpoint used by mem0.'
          )}
          {field(
            'LLM model',
            <Input value={llmModel} onChange={setLlmModel} placeholder="deepseek-v4-flash" />
          )}
          {field(
            'Embedding model',
            <Input
              value={embedderModel}
              onChange={setEmbedderModel}
              placeholder="text-embedding-v4"
            />
          )}
          {field(
            'Embedding dimensions',
            <InputNumber
              value={embeddingDims ?? undefined}
              min={1}
              onChange={(v) => setEmbeddingDims(typeof v === 'number' ? v : null)}
            />
          )}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            paddingTop: 4,
          }}
        >
          <Button theme="solid" loading={saving} onClick={save}>
            Save settings
          </Button>
          <Button loading={testing} onClick={runTest}>
            Test connection
          </Button>
          <Typography.Text type="tertiary" size="small">
            LLM and embedding settings are pushed through the mem0 /configure endpoint.
          </Typography.Text>
        </div>
        {testResult && (
          <div style={{ padding: 12, borderRadius: 10, background: 'var(--muted)' }}>
            <Typography.Text
              strong
              style={{ color: testResult.ok ? 'var(--primary)' : 'var(--destructive)' }}
            >
              {testResult.ok ? 'Test passed' : 'Test failed'}
            </Typography.Text>
            {(testResult.steps ?? []).map((step) => (
              <div
                key={step.name}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8 }}
              >
                {step.ok ? (
                  <IconTickCircle style={{ color: 'var(--primary)', marginTop: 2 }} />
                ) : (
                  <IconClose style={{ color: 'var(--destructive)', marginTop: 2 }} />
                )}
                <div>
                  <Tag size="small" color={step.ok ? 'green' : 'red'} style={{ marginRight: 8 }}>
                    {step.name}
                  </Tag>
                  <Typography.Text type="tertiary" size="small">
                    {step.detail}
                  </Typography.Text>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100%', overflow: 'hidden' }}>
      <nav
        aria-label="Settings sections"
        style={{
          width: 176,
          flexShrink: 0,
          borderRight: '1px solid var(--border)',
          background: 'color-mix(in oklch, var(--muted) 35%, transparent)',
          padding: 10,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {SETTINGS_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                theme={activeSection === item.id ? 'light' : 'borderless'}
                size="small"
                className="justify-start"
                onClick={() => setActiveSection(item.id)}
              >
                <Icon /> {item.label}
              </Button>
            );
          })}
        </div>
      </nav>
      <div style={{ minWidth: 0, flex: 1, overflow: 'auto', padding: '28px 24px 40px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
            <div>
              <Typography.Title heading={4} style={{ margin: 0 }}>
                {activeSettings.label}
              </Typography.Title>
              <Typography.Paragraph type="tertiary" style={{ margin: '5px 0 0' }}>
                {activeSettings.description}
              </Typography.Paragraph>
            </div>
            <Tag
              color={saving ? 'blue' : 'green'}
              style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
            >
              {saving ? 'Saving' : 'Saved'}
            </Tag>
          </div>

          {activeSection === 'execution' && (
            <Card style={{ overflow: 'hidden', boxShadow: 'none' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: 'var(--muted)',
                    color: 'var(--primary)',
                  }}
                >
                  <Clock3 size={17} />
                </div>
                <div>
                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    Execution
                  </Typography.Title>
                  <Typography.Paragraph type="tertiary" size="small" style={{ margin: '4px 0 0' }}>
                    Control the default limits applied to every workflow run.
                  </Typography.Paragraph>
                </div>
              </div>
              <div style={{ display: 'grid', gap: 16, padding: 18 }}>
                {field(
                  'Node timeout',
                  <InputNumber
                    value={value ?? undefined}
                    min={1}
                    max={MAX_TIMEOUT_MS}
                    step={60000}
                    onChange={(v) => setValue(typeof v === 'number' ? v : null)}
                  />,
                  'Milliseconds. Individual nodes can override this default.'
                )}
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    padding: 12,
                    borderRadius: 10,
                    background: 'var(--muted)',
                  }}
                >
                  <Clock3 size={16} style={{ marginTop: 2, color: 'var(--primary)' }} />
                  <Typography.Text type="tertiary" size="small">
                    A running node is cancelled after this limit. Workflow execution semantics
                    remain unchanged.
                  </Typography.Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button theme="solid" loading={saving} onClick={save}>
                    Save settings
                  </Button>
                </div>
              </div>
            </Card>
          )}
          {activeSection === 'memory' && memoryCard}
          {activeSection === 'local-data' && (
            <Card style={{ overflow: 'hidden', boxShadow: 'none' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: 'var(--muted)',
                    color: 'var(--primary)',
                  }}
                >
                  <Archive size={17} />
                </div>
                <div>
                  <Typography.Title heading={5} style={{ margin: 0 }}>
                    Local data
                  </Typography.Title>
                  <Typography.Paragraph type="tertiary" size="small" style={{ margin: '4px 0 0' }}>
                    Understand where workflows, agents and run history are stored.
                  </Typography.Paragraph>
                </div>
              </div>
              <div style={{ padding: 18 }}>
                <Typography.Text type="tertiary" size="small">
                  The application uses the configured local workflow data directory for SQLite
                  persistence.
                </Typography.Text>
              </div>
            </Card>
          )}
          {activeSection === 'skills' && (
            <Card style={{ overflow: 'hidden', boxShadow: 'none' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '16px 18px',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    background: 'var(--muted)',
                    color: 'var(--primary)',
                  }}
                >
                  <Layers size={17} />
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    flex: 1,
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <Typography.Title heading={5} style={{ margin: 0 }}>
                      Skills
                    </Typography.Title>
                    <Typography.Paragraph type="tertiary" size="small" style={{ margin: '4px 0 0' }}>
                      Global skill library. Each skill is a folder containing SKILL.md. Agents
                      enable skills via their own Skills section.
                    </Typography.Paragraph>
                  </div>
                  <Button
                    icon={<IconPlus />}
                    theme="solid"
                    size="small"
                    onClick={() => setEditorState({ mode: 'new' })}
                  >
                    New Skill
                  </Button>
                </div>
              </div>
              <div style={{ padding: 18 }}>
                {skills.length === 0 ? (
                  <Empty description="No skills yet — create one or import a folder" />
                ) : (
                  <List
                    dataSource={skills}
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
                        <div style={{ display: 'flex', gap: 4 }} className="shrink-0">
                          <Button
                            icon={<IconEdit />}
                            size="small"
                            theme="borderless"
                            onClick={() => setEditorState({ mode: 'edit', name: skill.name })}
                          />
                          <Button
                            icon={<IconDelete />}
                            size="small"
                            theme="borderless"
                            type="danger"
                            onClick={() => handleDeleteSkill(skill)}
                          />
                        </div>
                      </List.Item>
                    )}
                  />
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {editorState && (
        <SkillEditor
          initialName={editorState.mode === 'edit' ? editorState.name : null}
          existingNames={skills.map((s) => s.name)}
          onClose={() => setEditorState(null)}
          onSaved={() => reload()}
        />
      )}

      {deleteTarget && (
        <Modal
          visible
          title={deleteBlockedBy ? 'Skill is in use' : 'Delete skill'}
          onCancel={() => {
            setDeleteTarget(null);
            setDeleteBlockedBy(null);
          }}
          footer={
            deleteBlockedBy ? null : (
              <>
                <Button
                  theme="borderless"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteBlockedBy(null);
                  }}
                >
                  Cancel
                </Button>
                <Button type="danger" onClick={() => void confirmDeleteSkill()}>
                  Delete
                </Button>
              </>
            )
          }
        >
          {deleteBlockedBy ? (
            <>
              <Typography.Text>
                &quot;{deleteTarget.name}&quot; is enabled for:{' '}
                {deleteBlockedBy.join(', ')}. Disable it in those agents first.
              </Typography.Text>
            </>
          ) : (
            <Typography.Text>
              Delete &quot;{deleteTarget.name}&quot;? This cannot be undone.
            </Typography.Text>
          )}
        </Modal>
      )}
    </div>
  );
}
