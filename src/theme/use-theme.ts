/**
 * useTheme hook — React binding for the pure theme-controller.
 *
 * Wraps createThemeController in React state so components can read
 * resolvedTheme/themeMode and call setThemeMode/toggleTheme. The controller
 * itself is React-free and node-testable (Layer 2, #54 pattern).
 *
 * On mount: creates a controller (which reads localStorage, applies
 * body[theme-mode] — already set by the FOUC script — and subscribes to
 * matchMedia). On unmount: disposes the controller.
 *
 * `auto` mode follows `matchMedia('(prefers-color-scheme: dark)')` in real
 * time — the controller invokes our `onChange` callback when OS preference
 * changes, which triggers a React re-render. No second matchMedia listener
 * is needed here; the controller owns the single subscription.
 */
import { useCallback, useEffect, useState } from 'react';

import { createThemeController } from './theme-controller.mjs';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type ResolvedTheme = 'light' | 'dark';

export interface UseThemeReturn {
  resolvedTheme: ResolvedTheme;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

/**
 * React hook for theme state. Reads the initial body attribute (set by the
 * FOUC script) so first render matches first paint.
 */
export function useTheme(): UseThemeReturn {
  const [controller, setController] = useState<ReturnType<typeof createThemeController> | null>(
    null
  );
  // Bump a counter to trigger re-renders whenever the controller notifies.
  // The controller mutates its own state; we read it lazily in the getters
  // below, and this counter is what makes React notice the mutation.
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  useEffect(() => {
    const c = createThemeController({
      localStorage: window.localStorage,
      matchMedia: (q: string) => window.matchMedia(q),
      body: document.body,
      // Single subscription point — the controller calls this on every
      // resolved-theme change (setThemeMode, toggleTheme, or OS flip while
      // in 'auto' mode). Replaces the previous "second matchMedia listener"
      // workaround.
      onChange: () => rerender(),
    });
    setController(c);
    return () => c.dispose();
  }, [rerender]);

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      controller?.setThemeMode(mode);
      // Controller's onChange already triggers rerender, but call it here
      // too in case a future controller variant doesn't notify.
      rerender();
    },
    [controller, rerender]
  );

  const toggleTheme = useCallback(() => {
    controller?.toggleTheme();
    rerender();
  }, [controller, rerender]);

  return {
    resolvedTheme: controller?.resolvedTheme ?? 'light',
    themeMode: controller?.themeMode ?? 'auto',
    setThemeMode,
    toggleTheme,
  };
}
