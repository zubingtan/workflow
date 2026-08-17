import assert from 'node:assert/strict';
import test from 'node:test';

import { createThemeController, resolveThemeMode } from '../src/theme/theme-controller.mjs';

/**
 * Layer 2 — useTheme contract (pure core, no React).
 *
 * Mirrors the #54 pattern: theme-controller.mjs is the React-free core that
 * owns the theme state machine. The useTheme hook wraps it in React state.
 * Tests drive it directly with fakes for localStorage / matchMedia / body.
 */

function makeEnv({ stored = null, prefersDark = false } = {}) {
  const store = new Map();
  if (stored !== null) store.set('workflow-theme', stored);
  const listeners = new Set();
  const media = {
    matches: !!prefersDark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_evt, fn) => listeners.add(fn),
    removeEventListener: (_evt, fn) => listeners.delete(fn),
    // Keep the legacy matchMedia API in the test double for browser compatibility.
    addListener: (fn) => listeners.add(fn),
    removeListener: (fn) => listeners.delete(fn),
  };
  const matchMedia = (q) => (q === '(prefers-color-scheme: dark)' ? media : { matches: false, addEventListener() {}, removeEventListener() {} });
  const bodyAttrs = new Map();
  const body = {
    getAttribute: (k) => bodyAttrs.get(k) ?? null,
    setAttribute: (k, v) => bodyAttrs.set(k, String(v)),
    removeAttribute: (k) => bodyAttrs.delete(k),
  };
  const htmlAttrs = new Map();
  const htmlClasses = new Set();
  const html = {
    getAttribute: (k) => htmlAttrs.get(k) ?? null,
    setAttribute: (k, v) => htmlAttrs.set(k, String(v)),
    removeAttribute: (k) => htmlAttrs.delete(k),
    classList: {
      add: (name) => htmlClasses.add(name),
      remove: (name) => htmlClasses.delete(name),
      contains: (name) => htmlClasses.has(name),
    },
  };
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return { store, listeners, media, matchMedia, body, html, htmlAttrs, htmlClasses, localStorage, emitPrefersChange(next) {
    // Shim a matchMedia change.
    Object.defineProperty(media, 'matches', { value: !!next, configurable: true });
    for (const fn of listeners) fn({ matches: !!next });
  } };
}

test('resolveThemeMode: returns stored mode when set', () => {
  assert.equal(resolveThemeMode('light', false), 'light');
  assert.equal(resolveThemeMode('dark', false), 'dark');
  assert.equal(resolveThemeMode('light', true), 'light');
});

test('resolveThemeMode: falls back to prefers-color-scheme when stored is null/auto', () => {
  assert.equal(resolveThemeMode(null, false), 'light');
  assert.equal(resolveThemeMode(null, true), 'dark');
  assert.equal(resolveThemeMode('auto', false), 'light');
  assert.equal(resolveThemeMode('auto', true), 'dark');
});

test('controller: initial state reads localStorage > prefers-color-scheme > default light', () => {
  // localStorage wins over prefers-color-scheme.
  const env1 = makeEnv({ stored: 'light', prefersDark: true });
  const c1 = createThemeController(env1);
  assert.equal(c1.themeMode, 'light');
  assert.equal(c1.resolvedTheme, 'light');
  assert.equal(env1.body.getAttribute('theme-mode'), 'light');
  assert.equal(env1.html.getAttribute('data-theme'), 'light');
  assert.equal(env1.html.classList.contains('dark'), false);

  // prefers-color-scheme wins when no localStorage.
  const env2 = makeEnv({ stored: null, prefersDark: true });
  const c2 = createThemeController(env2);
  assert.equal(c2.themeMode, 'auto');
  assert.equal(c2.resolvedTheme, 'dark');
  assert.equal(env2.body.getAttribute('theme-mode'), 'dark');
  assert.equal(env2.html.getAttribute('data-theme'), 'dark');
  assert.equal(env2.html.classList.contains('dark'), true);

  // Default light.
  const env3 = makeEnv({ stored: null, prefersDark: false });
  const c3 = createThemeController(env3);
  assert.equal(c3.themeMode, 'auto');
  assert.equal(c3.resolvedTheme, 'light');
  assert.equal(env3.body.getAttribute('theme-mode'), 'light');
  assert.equal(env3.html.getAttribute('data-theme'), 'light');
  assert.equal(env3.html.classList.contains('dark'), false);
});

test('controller: setThemeMode writes localStorage and applies body attribute', () => {
  const env = makeEnv({ stored: null, prefersDark: false });
  const c = createThemeController(env);
  c.setThemeMode('dark');
  assert.equal(env.store.get('workflow-theme'), 'dark');
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');
  assert.equal(env.html.getAttribute('data-theme'), 'dark');
  assert.equal(env.html.classList.contains('dark'), true);
  assert.equal(c.themeMode, 'dark');
  assert.equal(c.resolvedTheme, 'dark');

  c.setThemeMode('light');
  assert.equal(env.store.get('workflow-theme'), 'light');
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
  assert.equal(env.html.getAttribute('data-theme'), 'light');
  assert.equal(env.html.classList.contains('dark'), false);
});

test('controller: setThemeMode("auto") follows prefers-color-scheme in real time', () => {
  const env = makeEnv({ stored: 'dark', prefersDark: false });
  const c = createThemeController(env);
  assert.equal(c.resolvedTheme, 'dark');

  c.setThemeMode('auto');
  // prefers-color-scheme is currently false (light).
  assert.equal(c.themeMode, 'auto');
  assert.equal(c.resolvedTheme, 'light');
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
  assert.equal(env.html.getAttribute('data-theme'), 'light');
  assert.equal(env.html.classList.contains('dark'), false);

  // OS preference flips to dark — controller must reflect in real time.
  env.emitPrefersChange(true);
  assert.equal(c.resolvedTheme, 'dark');
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');
  assert.equal(env.html.classList.contains('dark'), true);

  // localStorage stays as 'auto' (the user preference hasn't changed).
  assert.equal(env.store.get('workflow-theme'), 'auto');
});

test('controller: toggleTheme flips light<->dark; auto -> opposite of resolvedTheme', () => {
  const env = makeEnv({ stored: 'light', prefersDark: false });
  const c = createThemeController(env);
  c.toggleTheme();
  assert.equal(c.themeMode, 'dark');
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');
  assert.equal(env.store.get('workflow-theme'), 'dark');

  c.toggleTheme();
  assert.equal(c.themeMode, 'light');
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
  assert.equal(env.html.classList.contains('dark'), false);

  // Auto + resolved=light → toggle goes to dark.
  const env2 = makeEnv({ stored: 'auto', prefersDark: false });
  const c2 = createThemeController(env2);
  c2.toggleTheme();
  assert.equal(c2.themeMode, 'dark');
  assert.equal(env2.body.getAttribute('theme-mode'), 'dark');
  assert.equal(env2.html.classList.contains('dark'), true);
});

test('controller: subscribes to matchMedia on creation; cleans up on dispose', () => {
  const env = makeEnv({ stored: 'auto', prefersDark: false });
  const c = createThemeController(env);
  assert.ok(env.listeners.size > 0, 'controller must subscribe to matchMedia');
  c.dispose();
  assert.equal(env.listeners.size, 0, 'dispose must remove the matchMedia listener');
});

test('controller: real-time OS preference change flips body when in auto mode', () => {
  const env = makeEnv({ stored: 'auto', prefersDark: false });
  const c = createThemeController(env);
  assert.equal(c.resolvedTheme, 'light');

  env.emitPrefersChange(true);
  assert.equal(c.resolvedTheme, 'dark');
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');
  assert.equal(env.html.getAttribute('data-theme'), 'dark');
  assert.equal(env.html.classList.contains('dark'), true);

  env.emitPrefersChange(false);
  assert.equal(c.resolvedTheme, 'light');
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
  assert.equal(env.html.getAttribute('data-theme'), 'light');
  assert.equal(env.html.classList.contains('dark'), false);
});

test('controller: real-time OS preference change does NOT override explicit user choice', () => {
  const env = makeEnv({ stored: 'light', prefersDark: false });
  const c = createThemeController(env);
  env.emitPrefersChange(true);
  // User explicitly chose light — OS flip must not override.
  assert.equal(c.themeMode, 'light');
  assert.equal(c.resolvedTheme, 'light');
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
  assert.equal(env.html.classList.contains('dark'), false);
});

test('controller: synchronizes the canonical html class and data-theme with the legacy body attribute', () => {
  const env = makeEnv({ stored: 'light', prefersDark: false });
  const c = createThemeController(env);

  c.setThemeMode('dark');
  assert.equal(env.html.getAttribute('data-theme'), 'dark');
  assert.equal(env.html.classList.contains('dark'), true);
  assert.equal(env.body.getAttribute('theme-mode'), 'dark');

  c.setThemeMode('light');
  assert.equal(env.html.getAttribute('data-theme'), 'light');
  assert.equal(env.html.classList.contains('dark'), false);
  assert.equal(env.body.getAttribute('theme-mode'), 'light');
});
