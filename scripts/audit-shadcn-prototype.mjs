import { readFile } from 'node:fs/promises';

const prototypePath = new URL('../src/prototypes/shadcn-ui/prototype-app.tsx', import.meta.url);
const source = await readFile(prototypePath, 'utf8');

const forbiddenPatterns = [
  {
    label: 'native interactive HTML',
    pattern: /<(button|input|textarea|select|option|label|kbd)\b/g,
  },
  {
    label: 'manual interactive roles',
    pattern: /role=["']button["']|tabIndex=/g,
  },
  {
    label: 'manual sibling spacing',
    pattern: /\bspace-[xy]-/g,
  },
  {
    label: 'manual dark-mode utility',
    pattern: /\bdark:[^\s'"`]+/g,
  },
  {
    label: 'non-semantic palette utility',
    pattern:
      /\b(?:bg|border|text)-(?:blue|red|green|amber|orange|purple|violet|gray|slate|zinc|neutral)-/g,
  },
  {
    label: 'component variant class composition',
    pattern: /\b(?:buttonVariants|badgeVariants|toggleVariants)\s*\(/g,
  },
];

const violations = forbiddenPatterns.flatMap(({ label, pattern }) => {
  const matches = [...source.matchAll(pattern)];
  return matches.map((match) => {
    const line = source.slice(0, match.index).split('\n').length;
    return `${label} at line ${line}: ${match[0]}`;
  });
});

const requiredContracts = [
  ['settings section sidebar', 'aria-label="Settings sections"'],
  ['settings autosave state', 'type SettingsSaveState ='],
  ['memory model discovery', 'discoverMemoryModels'],
  ['LLM model select', 'id="memory-llm-model"'],
  ['embedding model select', 'id="memory-embedding-model"'],
  ['workflow list', 'aria-label="Workflow list"'],
  ['workflow history sheet', '<SheetTitle>Workflow history</SheetTitle>'],
  ['floating editor header', 'data-ui="floating-editor-header"'],
  ['pill canvas toolbar', 'data-ui="canvas-toolbar"'],
  ['pill canvas zoom controls', 'data-ui="canvas-zoom-controls"'],
  ['floating node inspector', 'data-ui="node-inspector"'],
  ['agent list row sizing', 'data-ui="agent-list-row"'],
  ['workflow list row sizing', 'data-ui="workflow-list-row"'],
  ['workflow list actions', 'data-ui="workflow-list-actions"'],
  ['agent list actions', 'data-ui="agent-list-actions"'],
  ['selection export surface', 'data-ui="export-selection"'],
  ['file import input', 'data-ui="import-file-input"'],
  ['import conflict surface', 'data-ui="import-conflict-sheet"'],
  ['new workflow action', 'data-ui="new-workflow"'],
  ['new agent action', 'data-ui="new-agent"'],
];

for (const [label, marker] of requiredContracts) {
  if (!source.includes(marker)) {
    violations.push(`missing ${label}: ${marker}`);
  }
}

if (source.includes('Save settings')) {
  violations.push('settings must autosave: Save settings');
}

if (source.includes('>Studio</span>')) {
  violations.push('workbench rail must not render the Studio brand block');
}

if (violations.length > 0) {
  console.error('Shadcn prototype audit failed:\n');
  console.error(violations.map((violation) => `- ${violation}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Shadcn prototype audit passed.');
}
