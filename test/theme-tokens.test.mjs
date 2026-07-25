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

test('Layer 1: src/theme/ contains the 7 mandated files', () => {
  const expected = [
    'tokens.css',
    'semi-bridge.css',
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

test('Layer 1: tokens.css defines primary family (light, on :root)', () => {
  const css = readCss('tokens.css');
  const vars = collectVars(css);
  // 8 primary family + focus, light values. These are PRIMITIVE tokens (raw
  // hex, not routing through Semi vars), so they live on `:root` and cascade
  // through to `body`. Dark overrides live in theme-dark.css on
  // `body[theme-mode="dark"]` (higher specificity wins).
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
  // Light primary must be #4d53e8 (per D4 locked values).
  assert.match(css, /--app-color-primary\s*:\s*#4d53e8/i);
  // Primary family must NOT be duplicated on `body` (would be a smell — :root
  // already cascades through).
  assert.doesNotMatch(
    css,
    /body\s*\{[^}]*--app-color-primary(?!-)/s,
    'primary family must not be re-declared on body — :root cascades'
  );
});

test('Layer 1: tokens.css defines grayscale semantic wrappers routing through Semi', () => {
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
});

test('Layer 1: tokens.css defines semantic status wrappers (route through Semi)', () => {
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

test('Layer 1: theme-dark.css defines dark primary #8a8cff + node-bg #1f1f2e + node-border #3a3a5c', () => {
  const css = readCss('theme-dark.css');
  assert.match(css, /--app-color-primary\s*:\s*#8a8cff/i);
  assert.match(css, /--app-color-node-bg\s*:\s*#1f1f2e/i);
  assert.match(css, /--app-color-node-border\s*:\s*#3a3a5c/i);
  // Dark overrides must hang off body[theme-mode="dark"] (D3 single source of truth).
  assert.match(css, /body\[theme-mode="dark"\]/);
});

test('Layer 1: semi-bridge.css overrides Semi primary family (8 + focus) on :root body + dark', () => {
  const css = readCss('semi-bridge.css');
  const vars = collectVars(css);
  for (const v of [
    '--semi-color-primary',
    '--semi-color-primary-hover',
    '--semi-color-primary-active',
    '--semi-color-primary-disabled',
    '--semi-color-primary-light-default',
    '--semi-color-primary-light-hover',
    '--semi-color-primary-light-active',
    '--semi-color-focus',
  ]) {
    assert.ok(vars.has(v), `missing Semi bridge var: ${v}`);
  }
  // Light override on `:root body` (D2 + D6 pitfall 2: must be body, not :root).
  assert.match(css, /:root\s+body\s*\{/);
  // Dark override on `body[theme-mode="dark"]`.
  assert.match(css, /body\[theme-mode="dark"\]\s*\{/);
  // Light primary must be #4d53e8.
  assert.match(css, /--semi-color-primary\s*:\s*#4d53e8/i);
});

test('Layer 1: flowgram-bridge.css bridges FlowGram --g-workflow-* vars to --app-* tokens', () => {
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
  // Dark variant must exist (spec AC #5).
  assert.match(css, /body\[theme-mode="dark"\]/);
});

test('Layer 1: app.tsx imports theme CSS files in the mandated order', () => {
  const appPath = path.resolve(__dirname, '..', 'src', 'app.tsx');
  const app = fs.readFileSync(appPath, 'utf8');
  const lines = app.split('\n');
  // Collect import lines (top of file).
  const imports = lines.filter((l) => /^\s*import\s/.test(l));
  const idx = (needle) => imports.findIndex((l) => l.includes(needle));
  const semiCss = idx('semi.min.css');
  const semiBridge = idx('theme/semi-bridge.css');
  const tokens = idx('theme/tokens.css');
  const dark = idx('theme/theme-dark.css');
  const flowgram = idx('theme/flowgram-bridge.css');
  const stylesCss = idx('styles/index.css');
  assert.ok(semiCss >= 0, 'semi.min.css not imported');
  assert.ok(semiBridge >= 0, 'semi-bridge.css not imported');
  assert.ok(tokens >= 0, 'tokens.css not imported');
  assert.ok(dark >= 0, 'theme-dark.css not imported');
  assert.ok(flowgram >= 0, 'flowgram-bridge.css not imported');
  assert.ok(stylesCss >= 0, 'styles/index.css not imported');
  // Order: semi.min.css < semi-bridge.css < tokens.css < theme-dark.css < flowgram-bridge.css < styles/index.css
  assert.ok(semiCss < semiBridge, 'semi.min.css must come before semi-bridge.css');
  assert.ok(semiBridge < tokens, 'semi-bridge.css must come before tokens.css');
  assert.ok(tokens < dark, 'tokens.css must come before theme-dark.css');
  assert.ok(dark < flowgram, 'theme-dark.css must come before flowgram-bridge.css');
  assert.ok(flowgram < stylesCss, 'flowgram-bridge.css must come before styles/index.css');
});
