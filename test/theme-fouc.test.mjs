import assert from 'node:assert/strict';
import test from 'node:test';

import { applyInitialTheme } from '../src/theme/fouc.mjs';

/**
 * Layer 3 — FOUC script (pure function, no React).
 *
 * The inline <script> in index.html must set body[theme-mode] BEFORE React
 * mounts, using the priority: localStorage['workflow-theme'] > prefers-color-scheme
 * > default light.
 *
 * Extracted into a testable function that takes injectable localStorage,
 * matchMedia, and body — same shape as theme-controller.mjs.
 */

function makeEnv({ stored = null, prefersDark = false } = {}) {
  const store = new Map();
  if (stored !== null) store.set('workflow-theme', stored);
  const bodyAttrs = new Map();
  const body = {
    getAttribute: (k) => bodyAttrs.get(k) ?? null,
    setAttribute: (k, v) => bodyAttrs.set(k, String(v)),
    removeAttribute: (k) => bodyAttrs.delete(k),
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
  };
  const matchMedia = (q) => ({
    matches: q === '(prefers-color-scheme: dark)' ? !!prefersDark : false,
  });
  return { store, body, localStorage, matchMedia };
}

test('FOUC: stored "dark" → body[theme-mode="dark"]', () => {
  const env = makeEnv({ stored: 'dark', prefersDark: false });
  applyInitialTheme(env);
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');
});

test('FOUC: stored "light" → body[theme-mode="light"]', () => {
  const env = makeEnv({ stored: 'light', prefersDark: true });
  applyInitialTheme(env);
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
});

test('FOUC: stored "auto" + prefers-color-scheme=dark → body[theme-mode="dark"]', () => {
  const env = makeEnv({ stored: 'auto', prefersDark: true });
  applyInitialTheme(env);
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');
});

test('FOUC: stored "auto" + prefers-color-scheme=light → body[theme-mode="light"]', () => {
  const env = makeEnv({ stored: 'auto', prefersDark: false });
  applyInitialTheme(env);
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
});

test('FOUC: no localStorage + prefers-color-scheme=dark → body[theme-mode="dark"]', () => {
  const env = makeEnv({ stored: null, prefersDark: true });
  applyInitialTheme(env);
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');
});

test('FOUC: no localStorage + prefers-color-scheme=light → body[theme-mode="light"] (default)', () => {
  const env = makeEnv({ stored: null, prefersDark: false });
  applyInitialTheme(env);
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
});

test('FOUC: invalid stored value falls back to prefers-color-scheme', () => {
  const env = makeEnv({ stored: 'garbage', prefersDark: true });
  applyInitialTheme(env);
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');
});

test('FOUC: function returns the resolved mode so the inline script can log if needed', () => {
  const env = makeEnv({ stored: 'dark', prefersDark: false });
  const result = applyInitialTheme(env);
  assert.equal(result, 'dark');
});
