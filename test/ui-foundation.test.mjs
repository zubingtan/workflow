import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

test('foundation config selects base-nova, Base UI, Lucide, and the canonical token stylesheet', () => {
  const config = JSON.parse(read('components.json'));

  assert.equal(config.style, 'base-nova');
  assert.equal(config.tailwind.css, 'src/theme/tokens.css');
  assert.equal(config.tailwind.config, '');
  assert.equal(config.aliases.ui, '@/components/ui');
  assert.equal(config.aliases.utils, '@/lib/utils');
  assert.equal(config.iconLibrary, 'lucide');
});

test('foundation dependencies and build wiring are present', () => {
  const packageJson = JSON.parse(read('package.json'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

  for (const name of [
    '@base-ui/react',
    'lucide-react',
    'tailwindcss',
    '@tailwindcss/postcss',
    'class-variance-authority',
    'clsx',
    'tailwind-merge',
  ]) {
    assert.ok(dependencies[name], `missing foundation dependency ${name}`);
  }

  const rsbuild = read('rsbuild.config.ts');
  assert.match(
    rsbuild,
    /resolve:\s*\{[\s\S]*['"]@['"]\s*:/,
    'Rsbuild must expose the @ -> src alias through resolve.alias'
  );
  assert.match(rsbuild, /@tailwindcss\/postcss/, 'Rsbuild must register Tailwind PostCSS');
});

test('representative production wrappers use Base UI primitives and semantic utilities', () => {
  const sources = {
    button: read('src/components/ui/button.tsx'),
    input: read('src/components/ui/input.tsx'),
    field: read('src/components/ui/field.tsx'),
    popover: read('src/components/ui/popover.tsx'),
    dialog: read('src/components/ui/dialog.tsx'),
  };

  assert.match(sources.button, /@base-ui\/react\/button/);
  assert.match(sources.input, /@base-ui\/react\/input/);
  assert.match(sources.field, /data-slot=["']field["']/);
  assert.match(sources.popover, /@base-ui\/react\/popover/);
  assert.match(sources.dialog, /@base-ui\/react\/dialog/);
  assert.match(sources.button, /bg-primary/);
  assert.match(sources.input, /border-input/);
  assert.match(sources.button, /dark:/);
  assert.match(sources.input, /dark:/);
});

test('canonical tokens register Tailwind v4 semantic utilities and preserve the FlowGram bridge', () => {
  const tokens = read('src/theme/tokens.css');
  const flowgram = read('src/theme/flowgram-bridge.css');

  assert.match(tokens, /@import ['"]tailwindcss\/theme\.css['"]/);
  assert.match(tokens, /@import ['"]tailwindcss\/utilities\.css['"]/);
  assert.match(tokens, /@custom-variant dark/);
  assert.match(tokens, /@theme inline/);
  for (const name of [
    '--background',
    '--foreground',
    '--primary',
    '--primary-foreground',
    '--border',
    '--input',
    '--ring',
  ]) {
    assert.match(tokens, new RegExp(`${name}\\s*:`), `missing canonical token ${name}`);
  }
  assert.match(tokens, /\.dark\s*\{/);
  assert.match(flowgram, /var\(--app-color-primary\)/);
  assert.match(flowgram, /var\(--app-color-canvas\)/);
});

test('the app consumes the foundation for theme, rename field, and confirmation dialog', () => {
  const app = read('src/app.tsx');

  assert.match(app, /from ['"]\.\/components\/ui['"]/);
  assert.match(app, /from ['"]lucide-react['"]/);
  assert.match(app, /<Popover/);
  assert.match(app, /<Dialog/);
  assert.match(app, /<Field/);
});
