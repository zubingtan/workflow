import { useCallback, useEffect, useRef, useState } from 'react';

import { createRoot } from 'react-dom/client';
import { unstableSetCreateRoot } from '@flowgram.ai/form-materials';
// Semi CSS must load before semi-bridge.css so the bridge overrides win.
// D6 pitfall 1: bare '@douyinfe/semi-ui/dist/css/semi.min.css' import path is
// blocked by the package's `exports` field under Semi 2.101.1, but the file
// physically exists at that path — rsbuild resolves it via the filesystem.
// If this breaks in a future Semi upgrade, switch to a relative path.
import '@douyinfe/semi-ui/dist/css/semi.min.css';
import { Button, Typography, Spin, Toast, Modal } from '@douyinfe/semi-ui';
import { IconArrowLeft, IconMoon, IconSave, IconSun } from '@douyinfe/semi-icons';

// Theme CSS files — order matters (ADR-0002):
//   semi.min.css → semi-bridge.css → tokens.css → theme-dark.css
//   → flowgram-bridge.css → ./styles/index.css → app code
import './theme/semi-bridge.css';
import './theme/tokens.css';
import './theme/theme-dark.css';
import './theme/flowgram-bridge.css';
import './styles/index.css';

import { FlowDocumentJSON } from './typings';
import { useTheme } from './theme';
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
  const { resolvedTheme, toggleTheme } = useTheme();

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
          borderRight: '1px solid var(--semi-color-border)',
          background: 'var(--semi-color-bg-1)',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 0',
        }}
      >
        {NAV_ITEMS.map((item) => (
          <div
            key={item.key}
            onClick={() => requestNavigation(() => setView(item.key))}
            style={{
              padding: '10px 16px',
              cursor: 'pointer',
              fontWeight: view === item.key ? 700 : 400,
              background: view === item.key ? 'var(--semi-color-fill-0)' : 'transparent',
              color: view === item.key ? 'var(--semi-color-primary)' : 'var(--semi-color-text-0)',
            }}
          >
            {item.label}
          </div>
        ))}
        {/* Spacer pushes the theme toggle to the sidebar bottom. */}
        <div style={{ flex: 1 }} />
        <div style={{ padding: '0 12px' }}>
          <Button
            icon={resolvedTheme === 'dark' ? <IconSun /> : <IconMoon />}
            theme="borderless"
            size="small"
            onClick={toggleTheme}
            aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          />
        </div>
      </div>

      {/* Main area */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          position: 'relative',
          background: 'var(--semi-color-bg-1)',
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
                <div style={{ padding: 24 }}>Failed to load workflow.</div>
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
