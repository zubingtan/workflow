import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

test('production no longer references the removed Semi/form-materials stack', () => {
  const files = [
    path.join(ROOT, 'package.json'),
    path.join(ROOT, 'pnpm-lock.yaml'),
    path.join(ROOT, 'rsbuild.config.ts'),
    path.join(ROOT, 'stylelint.config.js'),
    path.join(ROOT, 'lint-staged.config.js'),
    ...walk(path.join(ROOT, 'src')),
    ...walk(path.join(ROOT, 'server')),
  ];
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

  assert.doesNotMatch(source, /@douyinfe\/semi(?:-[\w-]+)?/);
  assert.doesNotMatch(source, /@flowgram\.ai\/form-materials/);
  assert.doesNotMatch(source, /--semi-[\w-]+/);
  assert.doesNotMatch(source, /semi-pulse/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'src/theme/semi-bridge.css')));
});

test('stale icon assets from the removed UI stack are gone', () => {
  for (const name of [
    'icon-auto-layout.tsx',
    'icon-comment.tsx',
    'icon-minimap.tsx',
    'icon-mouse.tsx',
    'icon-pad.tsx',
    'icon-switch-line.tsx',
  ]) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'src/assets', name)), `${name} should be removed`);
  }
});
