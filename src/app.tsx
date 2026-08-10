import { useCallback, useEffect, useRef, useState } from 'react';

import { createRoot } from 'react-dom/client';
import { ArrowLeft, LoaderCircle, Moon, Pencil, Save, Sun, Monitor } from 'lucide-react';
import { unstableSetCreateRoot } from '@flowgram.ai/form-materials';
// Semi CSS must load before semi-bridge.css so the bridge overrides win.
// D6 pitfall 1: bare '@douyinfe/semi-ui/dist/css/semi.min.css' import path is
// blocked by the package's `exports` field under Semi 2.101.1, but the file
// physically exists at that path — rsbuild resolves it via the filesystem.
// If this breaks in a future Semi upgrade, switch to a relative path.
import '@douyinfe/semi-ui/dist/css/semi.min.css';
import en_US from '@douyinfe/semi-ui/lib/es/locale/source/en_US';
import { Typography, Spin, Toast, LocaleProvider } from '@douyinfe/semi-ui';

// Theme CSS files — order matters (ADR-0002):
//   semi.min.css → semi-bridge.css → tokens.css → theme-dark.css
//   → flowgram-bridge.css → ./styles/index.css → app code
import './theme/semi-bridge.css';
import './theme/tokens.css';
import './theme/theme-dark.css';
import './theme/flowgram-bridge.css';
import './styles/index.css';

import { LayoutDirection } from './utils/rotate-ports';
import { FlowDocumentJSON } from './typings';
import { useTheme } from './theme';
import { GetGlobalVariableSchema } from './plugins/variable-panel-plugin';
import { WorkflowManager } from './manage';
import { initialData } from './initial-data';
import { Editor } from './editor';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from './components/ui';
import { AgentMillerColumns } from './components/agent-miller';
import { AdminSettings } from './components/admin-settings';
import * as api from './api';

unstableSetCreateRoot(createRoot);

type View = 'workflows' | 'agents' | 'settings' | 'editor';

const NAV_ITEMS: { key: View; label: string }[] = [
  { key: 'workflows', label: 'Workflows' },
  { key: 'agents', label: 'Agents' },
  { key: 'settings', label: 'Settings' },
];

/** Parse top-level hash route → view + optional workflowId */
function parseTopHash(): { view: View; workflowId: string | null } {
  const hash = window.location.hash;
  if (hash.startsWith('#/agents')) return { view: 'agents', workflowId: null };
  if (hash.startsWith('#/settings')) return { view: 'settings', workflowId: null };
  const wfMatch = hash.match(/^#\/workflows\/(.+)$/);
  if (wfMatch) return { view: 'editor', workflowId: wfMatch[1] };
  return { view: 'workflows', workflowId: null };
}

function App() {
  const [view, setView] = useState<View>(() => parseTopHash().view);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowData, setWorkflowData] = useState<FlowDocumentJSON | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [booted, setBooted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Inline rename state for the editor top-bar workflow name span.
  // `renaming` toggles the input; `renameDraft` holds the in-flight value.
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [confirmNav, setConfirmNav] = useState<{
    visible: boolean;
    action: (() => void) | null;
  }>({ visible: false, action: null });
  const ctxRef = useRef<any>(null);
  // #190: mirrors the current canvas layout direction so `saveWorkflow` can
  // persist it into the workflow JSON. Seeded 'LR' (default); the Editor's
  // LayoutDirectionProvider syncs it to the loaded workflow's direction on
  // mount and updates it on every toggle.
  const directionRef = useRef<LayoutDirection>('LR');
  const { themeMode, setThemeMode } = useTheme();
  const ThemeIcon = themeMode === 'auto' ? Monitor : themeMode === 'dark' ? Moon : Sun;

  // Seed a default workflow on first launch + restore hash-based route
  useEffect(() => {
    (async () => {
      try {
        const list = await api.listWorkflows();
        if (list.length === 0) {
          await api.createWorkflow('Default Workflow', initialData);
        }
      } catch {
        // server may be down; continue anyway
      } finally {
        setBooted(true);
        // Restore hash-based route on initial load (e.g. #/workflows/:id)
        const { view: initialView, workflowId } = parseTopHash();
        if (initialView === 'editor' && workflowId) {
          openWorkflow(workflowId);
        }
      }
    })();
  }, []);

  const openWorkflow = useCallback(async (id: string) => {
    setEditorLoading(true);
    setView('editor');
    setCurrentWorkflowId(id);
    setDirty(false);
    setRenaming(false);
    ctxRef.current = null;
    window.location.hash = `#/workflows/${id}`;
    try {
      const wf = await api.getWorkflow(id);
      setWorkflowName(wf.name);
      setWorkflowData(wf.data as FlowDocumentJSON);
    } catch {
      setWorkflowData(null);
    } finally {
      setEditorLoading(false);
    }
  }, []);

  const backToList = useCallback(() => {
    setView('workflows');
    setWorkflowData(null);
    setCurrentWorkflowId(null);
    window.location.hash = '#/workflows';
  }, []);

  /** Navigate to a top-level view, updating both state and hash. */
  const navigateTo = useCallback((v: View) => {
    setView(v);
    if (v === 'workflows') window.location.hash = '#/workflows';
    else if (v === 'agents') window.location.hash = '#/agents';
    else if (v === 'settings') window.location.hash = '#/settings';
  }, []);

  const saveWorkflow = useCallback(async () => {
    const ctx = ctxRef.current;
    if (!currentWorkflowId || !ctx) {
      Toast.warning('Editor not ready yet');
      return;
    }
    setSaving(true);
    try {
      const data = {
        ...ctx.document.toJSON(),
        // #190: persist the current layout direction so reopening a vertical
        // workflow keeps both node positions and port anchors vertical.
        direction: directionRef.current,
        globalVariable: ctx.get(GetGlobalVariableSchema)(),
      };
      await api.updateWorkflow(currentWorkflowId, { data });
      Toast.success('Workflow saved');
      setDirty(false);
    } catch (err: any) {
      Toast.error(err?.message || 'Failed to save workflow');
    } finally {
      setSaving(false);
    }
  }, [currentWorkflowId]);

  // Inline rename: click the workflow name span to edit it in place.
  // Enter or blur commits (name-only PATCH, canvas dirty state untouched);
  // Escape cancels. Empty input is rejected with a toast and reverts.
  const startRename = useCallback(() => {
    setRenameDraft(workflowName);
    setRenaming(true);
  }, [workflowName]);

  const commitRename = useCallback(async () => {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      Toast.warning('Workflow name cannot be empty');
      setRenaming(false);
      return;
    }
    if (trimmed === workflowName) {
      setRenaming(false);
      return;
    }
    if (!currentWorkflowId) {
      setRenaming(false);
      return;
    }
    try {
      await api.updateWorkflow(currentWorkflowId, { name: trimmed });
      setWorkflowName(trimmed);
    } catch (err: any) {
      Toast.error(err?.message || 'Failed to rename workflow');
    } finally {
      setRenaming(false);
    }
  }, [renameDraft, workflowName, currentWorkflowId]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
  }, []);

  const requestNavigation = useCallback(
    (action: () => void) => {
      if (!dirty) {
        action();
        return;
      }
      setConfirmNav({ visible: true, action });
    },
    [dirty]
  );

  const handleNavSave = useCallback(async () => {
    const action = confirmNav.action;
    setConfirmNav({ visible: false, action: null });
    await saveWorkflow();
    action?.();
  }, [confirmNav.action, saveWorkflow]);

  const handleNavDiscard = useCallback(() => {
    const action = confirmNav.action;
    setDirty(false);
    setConfirmNav({ visible: false, action: null });
    action?.();
  }, [confirmNav.action]);

  const handleNavCancel = useCallback(() => {
    setConfirmNav({ visible: false, action: null });
  }, []);

  // Guard page close / refresh when dirty
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // Listen for browser back/forward (hashchange) to sync top-level view.
  // AgentMillerColumns has its own useHashRoute for agent sub-routes;
  // this handles the top-level switch between workflows/agents/settings/editor.
  useEffect(() => {
    const handler = () => {
      const { view: hashView, workflowId } = parseTopHash();
      if (hashView === 'editor' && workflowId) {
        if (workflowId !== currentWorkflowId) openWorkflow(workflowId);
      } else if (hashView !== view) {
        setView(hashView);
      }
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, [view, currentWorkflowId, openWorkflow]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Left sidebar */}
      <div
        style={{
          width: 200,
          flexShrink: 0,
          borderRight: '1px solid var(--app-color-border)',
          background: 'var(--app-color-canvas)',
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--app-space-4) 0',
        }}
      >
        {NAV_ITEMS.map((item) => (
          <div
            key={item.key}
            onClick={() => requestNavigation(() => navigateTo(item.key))}
            style={{
              padding: 'var(--app-space-2) var(--app-space-4)',
              cursor: 'pointer',
              fontWeight: view === item.key ? 700 : 400,
              background: view === item.key ? 'var(--app-color-fill-0)' : 'transparent',
              color: view === item.key ? 'var(--app-color-primary)' : 'var(--app-color-text-1)',
            }}
          >
            {item.label}
          </div>
        ))}
        {/* Spacer pushes the theme toggle to the sidebar bottom. */}
        <div style={{ flex: 1 }} />
        <div style={{ padding: '0 var(--app-space-3)' }}>
          <Popover open={themeMenuOpen} onOpenChange={setThemeMenuOpen}>
            <PopoverTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="Choose theme">
                  <ThemeIcon />
                </Button>
              }
            />
            <PopoverContent align="start" className="w-40 p-1">
              <PopoverTitle className="sr-only">Theme</PopoverTitle>
              <div className="flex flex-col gap-1">
                {[
                  { mode: 'light' as const, label: 'Light', icon: Sun },
                  { mode: 'dark' as const, label: 'Dark', icon: Moon },
                  { mode: 'auto' as const, label: 'System', icon: Monitor },
                ].map(({ mode, label, icon: Icon }) => (
                  <Button
                    key={mode}
                    variant={themeMode === mode ? 'secondary' : 'ghost'}
                    size="sm"
                    className="justify-start"
                    onClick={() => {
                      setThemeMode(mode);
                      setThemeMenuOpen(false);
                    }}
                  >
                    <Icon />
                    {label}
                  </Button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Main area */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
          background: 'var(--app-color-canvas)',
        }}
      >
        {!booted ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
            }}
          >
            <Spin size="large" />
          </div>
        ) : view === 'workflows' ? (
          <WorkflowManager onOpen={(id) => requestNavigation(() => openWorkflow(id))} />
        ) : view === 'agents' ? (
          <AgentMillerColumns />
        ) : view === 'settings' ? (
          <AdminSettings />
        ) : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--app-space-2)',
                padding: 'var(--app-space-2) var(--app-space-4)',
                borderBottom: '1px solid var(--app-color-border)',
                background: 'var(--app-color-canvas)',
              }}
            >
              <Button variant="ghost" size="sm" onClick={() => requestNavigation(backToList)}>
                <ArrowLeft />
                Back
              </Button>
              {renaming ? (
                <Field className="w-[220px]">
                  <FieldLabel className="sr-only">Workflow name</FieldLabel>
                  <Input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void commitRename();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    autoFocus
                  />
                </Field>
              ) : (
                <span
                  onClick={startRename}
                  title="Click to rename"
                  style={{
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    lineHeight: 'inherit',
                  }}
                >
                  <Typography.Text strong>{workflowName}</Typography.Text>
                  <Pencil size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
                </span>
              )}
              <div style={{ marginLeft: 'auto' }}>
                <Button size="sm" disabled={!dirty || saving} onClick={saveWorkflow}>
                  {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
                  {saving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              {editorLoading ? (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100%',
                  }}
                >
                  <Spin size="large" />
                </div>
              ) : workflowData ? (
                <Editor
                  data={workflowData}
                  ctxRef={ctxRef}
                  onDirty={() => setDirty(true)}
                  workflowId={currentWorkflowId ?? undefined}
                  directionRef={directionRef}
                />
              ) : (
                <div style={{ padding: 24 }}>Failed to load workflow.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unsaved changes confirmation */}
      <Dialog
        open={confirmNav.visible}
        onOpenChange={(open) => {
          if (!open) handleNavCancel();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved changes. Do you want to save before leaving?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={handleNavCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleNavDiscard}>
              Discard
            </Button>
            <Button onClick={handleNavSave}>Save &amp; Leave</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const app = createRoot(document.getElementById('root')!);
app.render(
  <LocaleProvider locale={en_US}>
    <App />
  </LocaleProvider>
);
