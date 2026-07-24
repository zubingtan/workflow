// D6 PROTOTYPE — minimal theme entry.
// Throwaway: real index.ts per D1 will export ThemeMode, breakpoints, useTheme.

export type ThemeMode = 'light' | 'dark' | 'auto';

export const STORAGE_KEY = 'workflow-theme';

export function getStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch {}
  return null;
}

export function applyTheme(mode: ThemeMode) {
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effective = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode;
  if (typeof document !== 'undefined') {
    document.body.setAttribute('theme-mode', effective);
  }
}

export function setStoredTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {}
  applyTheme(mode);
}
