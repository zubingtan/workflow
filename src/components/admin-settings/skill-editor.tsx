import { useEffect, useMemo, useRef, useState } from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { Button, Input, Modal, Radio, RadioGroup, Toast, Typography } from '@douyinfe/semi-ui';
import {
  IconEdit,
  IconFolder,
  IconFile,
  IconUpload,
  IconSave,
  IconDelete,
} from '@douyinfe/semi-icons';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { javascript } from '@codemirror/lang-javascript';

import * as api from '../../api';

/**
 * Skill Editor — modal with a file tree on the left and a content pane on the
 * right (wayfinder #307). Editing happens in an in-memory draft; nothing is
 * written until Save confirms "save as <name>". Import (webkitdirectory
 * folder upload) replaces the draft with the uploaded tree after checking
 * SKILL.md presence, resolving name mismatches via a three-way dialog, and
 * confirming override of an existing skill.
 */

const SKILL_MD_TEMPLATE =
  '---\nname: <skill-name>\ndescription: What this skill does and when to use it\n---\n\n';

interface Frontmatter {
  name?: string;
  description?: string;
}

/** Mirrors server/skills.mjs parseSkillFrontmatter (single-line fields only). */
function parseFrontmatter(content: string): Frontmatter {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return {};
  const raw = lines.slice(1, end).join('\n');
  const readField = (key: string) => {
    const m = raw.match(new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, 'm'));
    if (!m) return undefined;
    const v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1);
    }
    return v;
  };
  return { name: readField('name'), description: readField('description') };
}

function rewriteFrontmatterName(content: string, newName: string): string {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return content;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return content;
  if (!lines.slice(1, end).some((l) => /^name\s*:/.test(l))) return content;
  for (let i = 1; i < end; i++) {
    if (/^name\s*:/.test(lines[i])) {
      lines[i] = `name: ${newName}`;
      break;
    }
  }
  return lines.join('\n');
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function editorLanguage(path: string) {
  if (path.endsWith('.md')) return markdown();
  if (path.endsWith('.json')) return json();
  if (/\.(js|jsx|ts|tsx|mjs|mts)$/.test(path)) return javascript();
  return undefined;
}

interface TreeNode {
  path: string;
  children?: TreeNode[];
}

function buildTree(files: api.SkillFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  const dirs = new Map<string, TreeNode>();
  for (const f of files) {
    const segments = f.path.split('/');
    let node: TreeNode | undefined;
    let dirPath = '';
    for (let i = 0; i < segments.length - 1; i++) {
      dirPath = dirPath ? `${dirPath}/${segments[i]}` : segments[i];
      let dir = dirs.get(dirPath);
      if (!dir) {
        dir = { path: dirPath, children: [] };
        dirs.set(dirPath, dir);
        const parentPath = dirPath.slice(0, dirPath.lastIndexOf('/'));
        const parent = parentPath ? dirs.get(parentPath) : undefined;
        if (parent) parent.children?.push(dir);
        else root.push(dir);
      }
      node = dir;
    }
    const leaf: TreeNode = { path: f.path };
    if (node) node.children?.push(leaf);
    else root.push(leaf);
  }
  const sortNode = (n: TreeNode) => {
    n.children?.sort((a, b) => {
      const aDir = Boolean(a.children);
      const bDir = Boolean(b.children);
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    n.children?.forEach(sortNode);
  };
  root.forEach(sortNode);
  return root;
}

function FileTree({
  nodes,
  selected,
  onSelect,
  collapsed,
  onToggle,
  depth = 0,
}: {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  depth?: number;
}) {
  return (
    <div>
      {nodes.map((node) => {
        if (node.children) {
          const isCollapsed = collapsed.has(node.path);
          return (
            <div key={node.path}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 0',
                  cursor: 'pointer',
                  paddingLeft: depth * 14,
                  fontSize: 13,
                  color: 'var(--semi-color-text-1)',
                }}
                onClick={() => onToggle(node.path)}
              >
                <IconFolder size="small" />
                <span>{isCollapsed ? '▸' : '▾'}</span>
                <span>{node.path.split('/').pop()}</span>
              </div>
              {!isCollapsed && (
                <FileTree
                  nodes={node.children ?? []}
                  selected={selected}
                  onSelect={onSelect}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }
        const isSelected = selected === node.path;
        return (
          <div
            key={node.path}
            onClick={() => onSelect(node.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 0',
              paddingLeft: depth * 14 + 18,
              cursor: 'pointer',
              fontSize: 13,
              background: isSelected ? 'var(--semi-color-primary-light-default)' : 'transparent',
              color: 'var(--semi-color-text-1)',
              borderRadius: 4,
            }}
          >
            <IconFile size="small" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.path.split('/').pop()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Three-way dialog for SKILL.md frontmatter name ≠ target name (decision #309). */
function NameMismatchDialog({
  frontmatterName,
  folderName,
  onResolve,
  onCancel,
}: {
  frontmatterName: string;
  folderName: string;
  onResolve: (choice: 'sync' | 'frontmatter' | 'custom', customName?: string) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<'sync' | 'frontmatter' | 'custom'>('sync');
  const [customName, setCustomName] = useState('');
  return (
    <Modal
      visible
      title="Skill name mismatch"
      onCancel={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            theme="solid"
            disabled={choice === 'custom' && !customName.trim()}
            onClick={() => onResolve(choice, choice === 'custom' ? customName.trim() : undefined)}
          >
            OK
          </Button>
        </>
      }
    >
      <Typography.Paragraph style={{ marginBottom: 12 }}>
        SKILL.md frontmatter name <code>{frontmatterName}</code> differs from the folder name{' '}
        <code>{folderName}</code>. Which name should the skill use?
      </Typography.Paragraph>
      <RadioGroup
        type="button"
        value={choice}
        onChange={(e) => setChoice(e.target.value as 'sync' | 'frontmatter' | 'custom')}
        style={{
          marginBottom: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'flex-start',
        }}
      >
        <Radio value="sync">Use folder name ({folderName}) — sync frontmatter</Radio>
        <Radio value="frontmatter">Use frontmatter name ({frontmatterName}) — rename folder</Radio>
        <Radio value="custom">Custom name</Radio>
      </RadioGroup>
      {choice === 'custom' && (
        <Input value={customName} onChange={setCustomName} placeholder="skill-name" />
      )}
    </Modal>
  );
}

interface Props {
  /** null = create a new skill; otherwise edit the existing skill. */
  initialName: string | null;
  /** Names already present in the library (for override confirmation). */
  existingNames: string[];
  onClose: () => void;
  onSaved: () => void;
}

export function SkillEditor({ initialName, existingNames, onClose, onSaved }: Props) {
  const [name, setName] = useState(initialName ?? '');
  const [files, setFiles] = useState<api.SkillFile[]>(() =>
    initialName ? [] : [{ path: 'SKILL.md', content: SKILL_MD_TEMPLATE }]
  );
  const [selectedPath, setSelectedPath] = useState<string | null>('SKILL.md');
  const [loading, setLoading] = useState(initialName !== null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nameDialog, setNameDialog] = useState<{
    frontmatterName: string;
    folderName: string;
  } | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    name: string;
    files: api.SkillFile[];
  } | null>(null);
  const [confirmOverride, setConfirmOverride] = useState<{
    name: string;
    files: api.SkillFile[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!initialName) return;
    api
      .getSkillTree(initialName)
      .then((tree) => {
        setFiles(tree.files);
        setSelectedPath(tree.files[0]?.path ?? null);
      })
      .catch((err) => Toast.error(err?.message || 'Failed to load skill'))
      .finally(() => setLoading(false));
  }, [initialName]);

  const tree = useMemo(() => buildTree(files), [files]);
  const selectedFile = files.find((f) => f.path === selectedPath);
  const isBinary = selectedFile?.encoding === 'base64';
  const originalName = initialName;

  const updateFile = (path: string, content: string) => {
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, content } : f)));
    setDirty(true);
  };

  const closeWithCheck = () => {
    if (dirty) {
      Modal.confirm({
        title: 'Discard draft?',
        content: 'You have unsaved changes. Closing will discard them.',
        okText: 'Discard',
        cancelText: 'Keep editing',
        onOk: onClose,
      });
    } else {
      onClose();
    }
  };

  const handleSave = () => {
    const targetName = name.trim();
    if (!targetName) {
      Toast.error('Skill name is required');
      return;
    }
    Modal.confirm({
      title: 'Save skill',
      content: `Save as "${targetName}" skill?`,
      okText: 'Save',
      onOk: async () => {
        setSaving(true);
        try {
          // Rename first when the editor is open on an existing skill with a
          // different name (folder rename + frontmatter sync happen server-side).
          if (originalName && originalName !== targetName) {
            await api.renameSkill(originalName, targetName);
          }
          await api.saveSkillTree(targetName, files);
          Toast.success(`Saved "${targetName}"`);
          onSaved();
          onClose();
        } catch (err: any) {
          Toast.error(err?.message || 'Save failed');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const readImportFolder = (input: HTMLInputElement) => {
    const fileList = input.files;
    input.value = '';
    if (!fileList || fileList.length === 0) return;
    const uploaded: { path: string; file: File }[] = [];
    for (const file of Array.from(fileList)) {
      const rel = file.webkitRelativePath;
      if (!rel) continue;
      uploaded.push({ path: rel, file });
    }
    if (uploaded.length === 0) {
      Toast.error('No files found in the selected folder');
      return;
    }
    const folderName = uploaded[0].path.split('/')[0];
    const hasSkillMd = uploaded.some((u) => u.path === `${folderName}/SKILL.md`);
    if (!hasSkillMd) {
      Toast.error('The selected folder must contain SKILL.md');
      return;
    }
    Promise.all(
      uploaded.map(async (u) => {
        const content = await u.file.text();
        const isText =
          u.file.type.startsWith('text/') ||
          /\.(md|json|js|ts|mjs|txt|yaml|yml|sh|css|html)$/i.test(u.path);
        return {
          path: u.path.slice(folderName.length + 1),
          content: isText ? content : arrayBufferToBase64(await u.file.arrayBuffer()),
          ...(isText ? {} : { encoding: 'base64' as const }),
        };
      })
    ).then((importedFiles) => {
      const skillMd = importedFiles.find((f) => f.path === 'SKILL.md');
      const fm = parseFrontmatter(skillMd?.content ?? '');
      // When editing an existing skill, import overrides it (name unchanged).
      const targetName = originalName || folderName;
      if (fm.name && fm.name !== targetName) {
        setNameDialog({ frontmatterName: fm.name, folderName: targetName });
        setPendingImport({ name: targetName, files: importedFiles });
      } else {
        requestOverrideConfirm(targetName, importedFiles);
      }
    });
  };

  const requestOverrideConfirm = (targetName: string, importedFiles: api.SkillFile[]) => {
    const exists = existingNames.includes(targetName);
    if (exists) {
      setConfirmOverride({ name: targetName, files: importedFiles });
    } else {
      applyImport(targetName, importedFiles);
    }
  };

  const applyImport = (targetName: string, importedFiles: api.SkillFile[]) => {
    setName(targetName);
    setFiles(importedFiles);
    setSelectedPath('SKILL.md');
    setDirty(true);
    setConfirmOverride(null);
    setPendingImport(null);
    Toast.success('Imported — review and save');
  };

  const handleNameResolve = (choice: 'sync' | 'frontmatter' | 'custom', customName?: string) => {
    if (!nameDialog || !pendingImport) return;
    let targetName = nameDialog.folderName;
    let importedFiles = pendingImport.files;
    if (choice === 'sync') {
      importedFiles = importedFiles.map((f) =>
        f.path === 'SKILL.md' ? { ...f, content: rewriteFrontmatterName(f.content, targetName) } : f
      );
    } else if (choice === 'frontmatter') {
      targetName = nameDialog.frontmatterName;
    } else if (customName) {
      targetName = customName;
      importedFiles = importedFiles.map((f) =>
        f.path === 'SKILL.md' ? { ...f, content: rewriteFrontmatterName(f.content, targetName) } : f
      );
    }
    setNameDialog(null);
    requestOverrideConfirm(targetName, importedFiles);
  };

  const handleDeleteFile = () => {
    if (!selectedPath) return;
    setFiles((prev) => prev.filter((f) => f.path !== selectedPath));
    setSelectedPath('SKILL.md');
    setDirty(true);
  };

  const handleNewFile = () => {
    Modal.info({
      title: 'New file',
      content: (
        <Input
          defaultValue=""
          placeholder="path/inside/skill.md"
          onEnterPress={(e) => {
            const p = ((e.target as HTMLInputElement).value ?? '').trim();
            if (p && !files.some((f) => f.path === p)) {
              setFiles((prev) => [...prev, { path: p, content: '' }]);
              setSelectedPath(p);
              setDirty(true);
            }
          }}
        />
      ),
    });
  };

  const hasChanges = dirty;

  return (
    <Modal
      visible
      width={980}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {originalName ? <IconEdit /> : <IconFile />}
          <span>{originalName ? 'Edit Skill' : 'New Skill'}</span>
        </div>
      }
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button icon={<IconUpload />} onClick={() => fileInputRef.current?.click()}>
              Import
            </Button>
            <Button icon={<IconDelete />} onClick={handleDeleteFile} disabled={!selectedPath}>
              Delete file
            </Button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {hasChanges && (
              <Button icon={<IconSave />} theme="solid" loading={saving} onClick={handleSave}>
                Save Skill
              </Button>
            )}
            <Button onClick={closeWithCheck}>Close</Button>
          </div>
        </div>
      }
      onCancel={closeWithCheck}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        {...({ webkitdirectory: '' } as any)}
        onChange={(e) => readImportFolder(e.target)}
      />
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <Typography.Text strong style={{ flexShrink: 0 }}>
          Name
        </Typography.Text>
        <Input
          value={name}
          onChange={(v) => {
            setName(v);
            if (v !== (originalName ?? '')) setDirty(true);
          }}
          placeholder="skill-name (folder name, lowercase a-z 0-9 -)"
          style={{ maxWidth: 320 }}
        />
        <Typography.Text type="tertiary" size="small">
          Renames the skill folder; SKILL.md frontmatter name is synced on save.
        </Typography.Text>
      </div>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>Loading…</div>
      ) : (
        <div
          style={{
            display: 'flex',
            height: 480,
            border: '1px solid var(--semi-color-border)',
            borderRadius: 6,
          }}
        >
          <div
            style={{
              width: 240,
              flexShrink: 0,
              borderRight: '1px solid var(--semi-color-border)',
              overflow: 'auto',
              padding: 8,
            }}
          >
            <FileTree
              nodes={tree}
              selected={selectedPath}
              onSelect={setSelectedPath}
              collapsed={collapsed}
              onToggle={(p) =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(p)) next.delete(p);
                  else next.add(p);
                  return next;
                })
              }
            />
            <Button
              size="small"
              icon={<IconFile />}
              onClick={handleNewFile}
              style={{ marginTop: 8 }}
            >
              New file
            </Button>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {!selectedFile ? (
              <div style={{ padding: 24, color: 'var(--semi-color-text-2)' }}>
                Select a file to edit
              </div>
            ) : isBinary ? (
              <div style={{ padding: 24, color: 'var(--semi-color-text-2)' }}>
                Binary file <code>{selectedFile.path}</code> — not editable in the browser.
              </div>
            ) : (
              <>
                <div
                  style={{
                    padding: '6px 12px',
                    borderBottom: '1px solid var(--semi-color-border)',
                    fontSize: 12,
                    color: 'var(--semi-color-text-2)',
                  }}
                >
                  {selectedFile.path}
                </div>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  {(() => {
                    const lang = editorLanguage(selectedFile.path);
                    return (
                      <CodeMirror
                        value={selectedFile.content}
                        height="100%"
                        extensions={lang ? [lang] : []}
                        onChange={(v) => updateFile(selectedFile.path, v)}
                        basicSetup={{ lineNumbers: true, foldGutter: false }}
                      />
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {nameDialog && pendingImport && (
        <NameMismatchDialog
          frontmatterName={nameDialog.frontmatterName}
          folderName={nameDialog.folderName}
          onResolve={handleNameResolve}
          onCancel={() => {
            setNameDialog(null);
            setPendingImport(null);
          }}
        />
      )}
      {confirmOverride && (
        <Modal
          visible
          title="Override skill"
          onCancel={() => setConfirmOverride(null)}
          footer={
            <>
              <Button onClick={() => setConfirmOverride(null)}>Cancel</Button>
              <Button
                theme="solid"
                onClick={() => applyImport(confirmOverride.name, confirmOverride.files)}
              >
                Override
              </Button>
            </>
          }
        >
          The imported folder will override the existing skill <code>{confirmOverride.name}</code>.
          Continue?
        </Modal>
      )}
    </Modal>
  );
}
