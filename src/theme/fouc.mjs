/**
 * FOUC (flash-of-unstyled-content) prevention — runs synchronously in
 * index.html BEFORE React mounts, so the first paint is already in the
 * correct theme.
 *
 * Priority: localStorage['workflow-theme'] > prefers-color-scheme > light.
 *
 * Extracted as a pure function so it can be tested under mocked
 * localStorage / matchMedia / document.body without a browser (Layer 3).
 * The inline <script> in index.html calls a thin wrapper that delegates to
 * this function with the real browser globals.
 */

const STORAGE_KEY = 'workflow-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Apply the initial theme to `body[theme-mode]` based on stored preference
 * and OS color scheme. Returns the resolved theme ('light' | 'dark').
 *
 * @param {object} env
 * @param {Storage} env.localStorage
 * @param {(query: string) => { matches: boolean }} env.matchMedia
 * @param {{ setAttribute: (k: string, v: string) => void }} env.body
 * @returns {'light' | 'dark'}
 */
export function applyInitialTheme(env) {
  const { localStorage, matchMedia, body } = env;
  let stored = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage may be disabled (private mode); fall back to OS preference.
    stored = null;
  }
  let resolved;
  if (stored === 'light' || stored === 'dark') {
    resolved = stored;
  } else {
    // 'auto', null, or invalid → prefers-color-scheme, defaulting to light.
    let prefersDark = false;
    try {
      prefersDark = !!matchMedia(MEDIA_QUERY).matches;
    } catch {
      prefersDark = false;
    }
    resolved = prefersDark ? 'dark' : 'light';
  }
  body.setAttribute('theme-mode', resolved);
  return resolved;
}
