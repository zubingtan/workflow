/**
 * Pure theme controller — the React-free core of useTheme.
 *
 * Owns the theme state machine: localStorage read/write, matchMedia
 * subscription, body[theme-mode] application. The hook (use-theme.ts) wraps
 * this with React state; tests drive this directly with fakes (#54 pattern,
 * mirrored from src/agent-execution/execute-agent-run.mjs).
 *
 * Theme priority: localStorage['workflow-theme'] > prefers-color-scheme > light.
 *
 * `themeMode` is the stored preference ('light' | 'dark' | 'auto').
 * `resolvedTheme` is the actual applied theme ('light' | 'dark') — when
 * themeMode is 'auto', it follows matchMedia in real time.
 *
 * Contract:
 *   - On creation: reads localStorage, resolves the initial theme, applies
 *     `body[theme-mode]`, and subscribes to matchMedia (so 'auto' mode
 *     follows OS preference changes in real time).
 *   - `setThemeMode(mode)`: writes localStorage, re-resolves, applies to body.
 *   - `toggleTheme()`: flips light↔dark. When themeMode is 'auto', toggles
 *     to the opposite of the current resolvedTheme.
 *   - `dispose()`: removes the matchMedia listener.
 */

const STORAGE_KEY = 'workflow-theme';
const MEDIA_QUERY = '(prefers-color-scheme: dark)';

/**
 * Resolve the actual theme ('light' | 'dark') from a stored preference and
 * the current prefers-color-scheme state. Exported for callers that need
 * pure resolution without a controller instance.
 *
 * @param {string|null} stored  'light' | 'dark' | 'auto' | null
 * @param {boolean} prefersDark  current matchMedia.matches value
 * @returns {'light' | 'dark'}
 */
export function resolveThemeMode(stored, prefersDark) {
  if (stored === 'light') return 'light';
  if (stored === 'dark') return 'dark';
  // 'auto', null, or invalid → fall back to prefers-color-scheme.
  return prefersDark ? 'dark' : 'light';
}

/**
 * Create a theme controller bound to the given environment.
 *
 * @param {object} env
 * @param {Storage} env.localStorage
 * @param {(query: string) => { matches: boolean, addEventListener?: (e: string, fn: (e: any) => void) => void, removeEventListener?: (e: string, fn: (e: any) => void) => void, addListener?: (fn: (e: any) => void) => void, removeListener?: (fn: (e: any) => void) => void }} env.matchMedia
 * @param {{ getAttribute: (k: string) => string | null, setAttribute: (k: string, v: string) => void, removeAttribute?: (k: string) => void }} env.body
 * @param {(resolved: 'light' | 'dark') => void} [env.onChange]  Optional subscriber; invoked whenever the resolved theme changes (from setThemeMode, toggleTheme, or OS preference flip while in 'auto' mode). The hook uses this to trigger React re-renders without re-subscribing to matchMedia.
 * @returns {{
 *   themeMode: 'light' | 'dark' | 'auto',
 *   resolvedTheme: 'light' | 'dark',
 *   setThemeMode: (mode: 'light' | 'dark' | 'auto') => void,
 *   toggleTheme: () => void,
 *   dispose: () => void,
 * }}
 */
export function createThemeController(env) {
  const { localStorage, matchMedia, body, onChange: userOnChange } = env;
  const media = matchMedia(MEDIA_QUERY);

  let stored = localStorage.getItem(STORAGE_KEY);
  if (stored !== 'light' && stored !== 'dark' && stored !== 'auto') {
    stored = null;
  }
  let themeMode = stored ?? 'auto';

  const readPrefers = () => !!media && !!media.matches;

  const apply = () => {
    const resolved = resolveThemeMode(themeMode, readPrefers());
    body.setAttribute('theme-mode', resolved);
    return resolved;
  };

  let currentResolved = apply();

  // Single notification point — every state mutation routes through here.
  // The hook subscribes via env.onChange so it doesn't need its own matchMedia
  // listener to detect controller-initiated changes.
  const notify = () => {
    if (typeof userOnChange === 'function') userOnChange(currentResolved);
  };

  const onMediaChange = () => {
    if (themeMode !== 'auto') return; // explicit user choice wins
    currentResolved = apply();
    notify();
  };

  // matchMedia supports both addEventListener (modern) and addListener (Safari < 14).
  if (media && typeof media.addEventListener === 'function') {
    media.addEventListener('change', onMediaChange);
  } else if (media && typeof media.addListener === 'function') {
    media.addListener(onMediaChange);
  }

  return {
    get themeMode() {
      return themeMode;
    },
    get resolvedTheme() {
      // Re-read in case matchMedia changed since the last apply (defensive).
      return resolveThemeMode(themeMode, readPrefers());
    },
    setThemeMode(mode) {
      themeMode = mode;
      // Persist the user's preference — including 'auto' so reopening keeps
      // "follow OS" mode (spec: "toggling back to 'auto' resumes following").
      localStorage.setItem(STORAGE_KEY, mode);
      currentResolved = apply();
      notify();
    },
    toggleTheme() {
      // Flip light↔dark; auto → opposite of resolvedTheme.
      const opposite = currentResolved === 'dark' ? 'light' : 'dark';
      this.setThemeMode(opposite);
    },
    dispose() {
      if (media && typeof media.removeEventListener === 'function') {
        media.removeEventListener('change', onMediaChange);
      } else if (media && typeof media.removeListener === 'function') {
        media.removeListener(onMediaChange);
      }
    },
  };
}
