import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const THEME_DIR = path.resolve(__dirname, '..', 'src', 'theme');

function readCss(name) {
  const p = path.join(THEME_DIR, name);
  assert.ok(fs.existsSync(p), `missing file: ${name}`);
  return fs.readFileSync(p, 'utf8');
}

/** Collect `--var-name: value;` declarations from a CSS source string. */
function collectVars(css) {
  const out = new Set();
  // Match `--name: ...;` — tolerate multiline values, but our files are flat.
  const re = /(--[a-zA-Z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(css)) !== null) out.add(m[1]);
  return out;
}

test('Layer 1: src/theme/ contains the canonical theme files', () => {
  const expected = [
    'tokens.css',
    'flowgram-bridge.css',
    'theme-dark.css',
    'index.ts',
    'use-theme.ts',
    'theme-controller.mjs',
  ];
  for (const f of expected) {
    const p = path.join(THEME_DIR, f);
    assert.ok(fs.existsSync(p), `missing theme file: ${f}`);
  }
});

test('Layer 1: tokens.css defines primitive spacing scale (4px base × 10 tiers)', () => {
  const vars = collectVars(readCss('tokens.css'));
  // 0/4/8/12/16/20/24/32/40/48px named --app-space-0..12 (skipping 7,9,11)
  for (const n of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12]) {
    assert.ok(vars.has(`--app-space-${n}`), `missing --app-space-${n}`);
  }
});

test('Layer 1: tokens.css defines 4 radius tiers', () => {
  const vars = collectVars(readCss('tokens.css'));
  for (const t of ['sm', 'md', 'lg', 'full']) {
    assert.ok(vars.has(`--app-radius-${t}`), `missing --app-radius-${t}`);
  }
});

test('Layer 1: tokens.css defines 5 font-size + 3 font-weight tiers', () => {
  const vars = collectVars(readCss('tokens.css'));
  for (const t of ['xs', 'sm', 'md', 'lg', 'xl']) {
    assert.ok(vars.has(`--app-font-size-${t}`), `missing --app-font-size-${t}`);
  }
  for (const t of ['regular', 'medium', 'strong']) {
    assert.ok(vars.has(`--app-font-weight-${t}`), `missing --app-font-weight-${t}`);
  }
});

test('Layer 1: tokens.css defines 3 shadow tiers', () => {
  const vars = collectVars(readCss('tokens.css'));
  for (const t of ['sm', 'md', 'lg']) {
    assert.ok(vars.has(`--app-shadow-${t}`), `missing --app-shadow-${t}`);
  }
});

test('Layer 1: tokens.css defines the established primary family', () => {
  const css = readCss('tokens.css');
  const vars = collectVars(css);
  // The app aliases live on body so light/dark values can be overridden on the
  // same element without depending on the removed component library.
  for (const v of [
    '--app-color-primary',
    '--app-color-primary-hover',
    '--app-color-primary-active',
    '--app-color-primary-disabled',
    '--app-color-primary-light-default',
    '--app-color-primary-light-hover',
    '--app-color-primary-light-active',
    '--app-color-focus',
  ]) {
    assert.ok(vars.has(v), `missing ${v}`);
  }
  assert.match(css, /--app-color-primary\s*:\s*#4d53e8/i);
  assert.match(css, /body\s*\{[^}]*--app-color-primary(?!-)/s);
});

test('Layer 1: tokens.css defines grayscale semantic wrappers from canonical tokens', () => {
  const vars = collectVars(readCss('tokens.css'));
  for (const v of [
    '--app-color-canvas',
    '--app-color-surface',
    '--app-color-overlay',
    '--app-color-panel',
    '--app-color-text-1',
    '--app-color-text-2',
    '--app-color-text-3',
    '--app-color-text-disabled',
    '--app-color-border',
    '--app-color-divider',
    '--app-color-fill-0',
    '--app-color-fill-1',
    '--app-color-fill-2',
  ]) {
    assert.ok(vars.has(v), `missing ${v}`);
  }
  const css = readCss('tokens.css');
  for (const [name, token] of [
    ['--app-color-canvas', '--background'],
    ['--app-color-surface', '--card'],
    ['--app-color-overlay', '--popover'],
    ['--app-color-text-1', '--foreground'],
    ['--app-color-border', '--border'],
  ]) {
    assert.match(css, new RegExp(`${name}\\s*:\\s*var\\(${token}\\)`));
  }
});

test('Layer 1: tokens.css defines semantic status wrappers', () => {
  const vars = collectVars(readCss('tokens.css'));
  for (const v of [
    '--app-color-success',
    '--app-color-warning',
    '--app-color-danger',
    '--app-color-info',
  ]) {
    assert.ok(vars.has(v), `missing ${v}`);
  }
});

test('Layer 1: tokens.css defines node-card tokens', () => {
  const vars = collectVars(readCss('tokens.css'));
  for (const v of ['--app-color-node-bg', '--app-color-node-border']) {
    assert.ok(vars.has(v), `missing ${v}`);
  }
});

test('Layer 1: tokens.css applies global body reset (background-color + color + margin: 0)', () => {
  const css = readCss('tokens.css');
  // D6 pitfalls 3 + 4: must set body background + reset body margin.
  assert.match(css, /body\s*\{[^}]*background-color\s*:\s*var\(--app-color-canvas\)/s);
  assert.match(css, /body\s*\{[^}]*margin\s*:\s*0/s);
});

// Prettier reformats CSS attribute selectors to single quotes (.prettierrc:
// singleQuote: true). Tests should assert on the selector existence, not on a
// specific quote style — so accept either `body[theme-mode='dark']` or
// `body[theme-mode="dark"]`.
const DARK_SELECTOR = /body\[theme-mode=['"]dark['"]\]/;

test('Layer 1: theme-dark.css preserves the established dark palette', () => {
  const css = readCss('theme-dark.css');
  assert.match(css, /--app-color-primary\s*:\s*#8a8cff/i);
  assert.match(css, /--app-color-node-bg\s*:\s*#252530/i);
  assert.match(css, /--app-color-node-border\s*:\s*#3a3a4a/i);
  // Dark mode softens the node header gradient (drops primary-light tint).
  assert.match(css, /--app-color-node-header-from\s*:\s*var\(--app-color-fill-0\)/i);
  // Dark overrides must hang off body[theme-mode=dark] (D3 single source of truth).
  assert.match(css, DARK_SELECTOR);
});

test('Layer 1: flowgram-bridge.css bridges FlowGram variables to app tokens', () => {
  const css = readCss('flowgram-bridge.css');
  // Spec AC #5: bridge the --g-workflow-* family consumed by
  // src/hooks/use-editor-props.tsx (port + line colors). These are the real
  // FlowGram variables used in this codebase.
  for (const v of [
    '--g-workflow-port-color-primary',
    '--g-workflow-port-color-secondary',
    '--g-workflow-line-color-default',
  ]) {
    assert.match(css, new RegExp(`${v}\\s*:`), `missing FlowGram bridge for ${v}`);
  }
  // Bridge must route through --app-* tokens (not hardcoded hex).
  assert.match(css, /var\(--app-color-primary\)/, 'bridge must use --app-color-primary');
  // --g-editor-background must be bridged so the canvas follows the theme
  // (without this, dark mode left the canvas on FlowGram's default #f2f3f5).
  assert.match(
    css,
    /--g-editor-background\s*:\s*var\(--app-color-canvas\)/,
    'must bridge --g-editor-background to --app-color-canvas'
  );
  // Dark variant must exist (spec AC #5).
  assert.match(css, DARK_SELECTOR);
});

test('Layer 1: app.tsx imports theme CSS files in the canonical order', () => {
  const appPath = path.resolve(__dirname, '..', 'src', 'app.tsx');
  const app = fs.readFileSync(appPath, 'utf8');
  const lines = app.split('\n');
  // Collect import lines (top of file).
  const imports = lines.filter((l) => /^\s*import\s/.test(l));
  const idx = (needle) => imports.findIndex((l) => l.includes(needle));
  const tokens = idx('theme/tokens.css');
  const dark = idx('theme/theme-dark.css');
  const flowgram = idx('theme/flowgram-bridge.css');
  const stylesCss = idx('styles/index.css');
  assert.ok(tokens >= 0, 'tokens.css not imported');
  assert.ok(dark >= 0, 'theme-dark.css not imported');
  assert.ok(flowgram >= 0, 'flowgram-bridge.css not imported');
  assert.ok(stylesCss >= 0, 'styles/index.css not imported');
  // Order: tokens.css < theme-dark.css < flowgram-bridge.css < styles/index.css
  assert.ok(tokens < dark, 'tokens.css must come before theme-dark.css');
  assert.ok(dark < flowgram, 'theme-dark.css must come before flowgram-bridge.css');
  assert.ok(flowgram < stylesCss, 'flowgram-bridge.css must come before styles/index.css');
});
