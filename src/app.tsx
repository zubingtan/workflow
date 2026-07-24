import { useCallback, useEffect, useRef, useState } from 'react';

import { createRoot } from 'react-dom/client';
import { unstableSetCreateRoot } from '@flowgram.ai/form-materials';
import { Button, Typography, Spin, Toast, Modal, IconButton } from '@douyinfe/semi-ui';
import { IconArrowLeft, IconSave, IconSun, IconMoon } from '@douyinfe/semi-icons';

// D6 PROTOTYPE — theme layer. Order matters: semi.min.css first (D2 bug fix),
// then semi-bridge override, then app tokens. Real implement will move these
// into src/theme/index.ts per D1.
//
// NOTE: Semi 2.101.1's package.json `exports` field omits `./dist/css/*`, so a
// bare `@douyinfe/semi-ui/dist/css/semi.min.css` import fails under rspack.
// Reaching the file via a relative node_modules path bypasses `exports`.
// This is a known Semi packaging gap — implement session should confirm the
// canonical path (or switch to per-component CSS imports).
import '@douyinfe/semi-ui/dist/css/semi.min.css';
import './theme/semi-bridge.css';
import './theme/tokens.css';

import { FlowDocumentJSON } from './typings';
import { ThemeMode, getStoredTheme, setStoredTheme } from './theme';
import { GetGlobalVariableSchema } from './plugins/variable-panel-plugin';
import { WorkflowManager, AgentManager } from './manage';
import { initialData } from './initial-data';
import { Editor } from './editor';
import * as api from './api';

unstableSetCreateRoot(createRoot);

type View = 'workflows' | 'agents' | 'editor';

const NAV_ITEMS: { key: View; label: string }[] = [
  { key: 'workflows', label: 'Workflows' },
  { key: 'agents', label: 'Agents' },
];

function App() {
  const [view, setView] = useState<View>('workflows');
  const [workflowName, setWorkflowName] = useState('');
  const [workflowData, setWorkflowData] = useState<FlowDocumentJSON | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [booted, setBooted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentWorkflowId, setCurrentWorkflowId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmNav, setConfirmNav] = useState<{
    visible: boolean;
    action: (() => void) | null;
  }>({ visible: false, action: null });
  const ctxRef = useRef<any>(null);

  // D6 PROTOTYPE — theme state. On mount, read stored theme (FOUC script in
  // index.html already set body[theme-mode] before React; this keeps toggle UI
  // in sync and re-applies in case the script didn't run).
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme() ?? 'auto');
  useEffect(() => {
    setStoredTheme(theme);
  }, [theme]);

  // Seed a default workflow on first launch
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
      }
    })();
  }, []);

  const openWorkflow = useCallback(async (id: string) => {
    setEditorLoading(true);
    setView('editor');
    setCurrentWorkflowId(id);
    setDirty(false);
    ctxRef.current = null;
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

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Left sidebar */}
      <div
        style={{
          width: 200,
          flexShrink: 0,
          borderRight: `1px solid var(--app-color-border)`,
          background: 'var(--app-color-panel)',
          display: 'flex',
          flexDirection: 'column',
          padding: 'var(--app-space-4) 0',
        }}
      >
        {NAV_ITEMS.map((item) => (
          <div
            key={item.key}
            onClick={() => requestNavigation(() => setView(item.key))}
            style={{
              padding: '10px var(--app-space-4)',
              cursor: 'pointer',
              fontWeight:
                view === item.key
                  ? 'var(--app-font-weight-strong)'
                  : 'var(--app-font-weight-regular)',
              background: view === item.key ? 'var(--app-color-fill-0)' : 'transparent',
              color: view === item.key ? 'var(--app-color-primary)' : 'var(--app-color-text-1)',
              fontSize: 'var(--app-font-size-md)',
            }}
          >
            {item.label}
          </div>
        ))}
        {/* D6 PROTOTYPE — theme toggle (D3 spec: sidebar bottom, icon button) */}
        <div style={{ marginTop: 'auto', padding: '0 var(--app-space-4)' }}>
          <IconButton
            theme="borderless"
            icon={theme === 'dark' ? <IconSun /> : <IconMoon />}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          />
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
          <AgentManager />
        ) : (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderBottom: '1px solid var(--semi-color-border)',
                background: 'var(--semi-color-bg-1)',
              }}
            >
              <Button
                icon={<IconArrowLeft />}
                theme="borderless"
                size="small"
                onClick={() => requestNavigation(backToList)}
              >
                Back
              </Button>
              <Typography.Text strong>{workflowName}</Typography.Text>
              <div style={{ marginLeft: 'auto' }}>
                <Button
                  icon={<IconSave />}
                  size="small"
                  theme="solid"
                  loading={saving}
                  disabled={!dirty}
                  onClick={saveWorkflow}
                >
                  Save Workflow
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
                <Editor data={workflowData} ctxRef={ctxRef} onDirty={() => setDirty(true)} />
              ) : (
                <div style={{ padding: 'var(--app-space-6)' }}>Failed to load workflow.</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unsaved changes confirmation */}
      <Modal
        title="Unsaved Changes"
        visible={confirmNav.visible}
        onCancel={handleNavCancel}
        closable
        closeOnEsc
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button theme="borderless" onClick={handleNavCancel}>
              Cancel
            </Button>
            <Button theme="light" type="danger" onClick={handleNavDiscard}>
              Discard
            </Button>
            <Button theme="solid" onClick={handleNavSave}>
              Save & Leave
            </Button>
          </div>
        }
      >
        You have unsaved changes. Do you want to save before leaving?
      </Modal>
    </div>
  );
}

const app = createRoot(document.getElementById('root')!);
app.render(<App />);
