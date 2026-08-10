import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

const MANAGEMENT_SURFACES = [
  'src/app.tsx',
  'src/manage.tsx',
  'src/components/admin-settings/index.tsx',
  'src/components/history-modal/index.tsx',
  'src/components/history-modal/runs-table.tsx',
  'src/components/readonly-viewer/index.tsx',
  'src/components/agent-miller/index.tsx',
  'src/components/agent-miller/session-detail.tsx',
  ...fs
    .readdirSync(path.join(ROOT, 'src/components/agent-miller/sections'))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => `src/components/agent-miller/sections/${name}`),
];

test('management surfaces use the local UI layer instead of Semi UI', () => {
  for (const relativePath of MANAGEMENT_SURFACES) {
    const source = fs
      .readFileSync(path.join(ROOT, relativePath), 'utf8')
      // The editor still needs Semi's stylesheet as a compatibility bridge;
      // management surfaces must not import its component or icon packages.
      .replace(/import ['"]@douyinfe\/semi-ui\/dist\/css\/semi\.min\.css['"];?/g, '');
    assert.doesNotMatch(
      source,
      /@douyinfe\/semi(?:-ui|-icons)/,
      `${relativePath} must not expose a Semi UI entry point`
    );
    assert.doesNotMatch(
      source,
      /var\(--semi-color-/,
      `${relativePath} must consume canonical management tokens`
    );
  }
});

test('the application shell mounts the shared management feedback surface', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/app.tsx'), 'utf8');
  assert.match(source, /ToastViewport/);
  assert.match(source, /data-testid="app-shell"/);
});
