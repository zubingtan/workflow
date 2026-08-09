/**
 * useTheme hook — React binding for the pure theme-controller.
 *
 * Wraps createThemeController in React state so components can read
 * resolvedTheme/themeMode and call setThemeMode/toggleTheme. The controller
 * itself is React-free and node-testable (Layer 2, #54 pattern).
 *
 * **Singleton controller**: the controller is created once at module load
 * and shared across all `useTheme()` callers. This is necessary because
 * `<Minimap>` (rendered inside FlowGram's panel-manager-plugin) and `<App>`
 * both call `useTheme()` — if each got its own controller, `<App>`'s
 * `toggleTheme()` would notify only `<App>`, and `<Minimap>` would never
 * see the change (its controller is a separate instance with its own
 * matchMedia listener, which doesn't fire on user-initiated toggles).
 *
 * The shared controller holds a Set of React `force` callbacks; every
 * `setThemeMode` / `toggleTheme` / matchMedia change invokes all of them,
 * so every subscribed component re-renders in lockstep.
 *
 * On mount: a component subscribes its `force` callback to the singleton.
 * On unmount: the callback is removed. The controller itself is never
 * disposed — it lives for the page lifetime (matching the original design
 * where the FOUC script has already set body[theme-mode] before React
 * mounts, and the controller takes over from there).
 *
 * `auto` mode follows `matchMedia('(prefers-color-scheme: dark)')` in real
 * time — the controller's matchMedia subscription invokes all subscribers
 * when OS preference changes.
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

// --- Singleton controller (module scope, shared by all useTheme callers) ---
// Created lazily on first use in the browser. Stays null in SSR / Node tests
// (tests import createThemeController directly from theme-controller.mjs).
interface SingletonState {
  controller: ReturnType<typeof createThemeController>;
  subscribers: Set<() => void>;
}
let singleton: SingletonState | null = null;

function getSingleton(): SingletonState {
  if (singleton) return singleton;
  const subscribers = new Set<() => void>();
  const notifyAll = () => {
    // Defer to next microtask so multiple synchronous state changes (e.g.
    // setThemeMode → apply → notify) batch into a single React re-render.
    // Using queueMicrotask keeps it deterministic without a full macrotask.
    queueMicrotask(() => {
      subscribers.forEach((fn) => fn());
    });
  };
  const controller = createThemeController({
    localStorage: window.localStorage,
    matchMedia: (q: string) => window.matchMedia(q),
    body: document.body,
    html: document.documentElement,
    onChange: () => notifyAll(),
  });
  singleton = { controller, subscribers };
  return singleton;
}

/**
 * React hook for theme state. Reads the initial body attribute (set by the
 * FOUC script) so first render matches first paint.
 */
export function useTheme(): UseThemeReturn {
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  useEffect(() => {
    const { subscribers } = getSingleton();
    subscribers.add(rerender);
    return () => {
      subscribers.delete(rerender);
    };
  }, [rerender]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    const { controller } = getSingleton();
    controller.setThemeMode(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    const { controller } = getSingleton();
    controller.toggleTheme();
  }, []);

  const { controller } = getSingleton();
  return {
    resolvedTheme: controller.resolvedTheme,
    themeMode: controller.themeMode,
    setThemeMode,
    toggleTheme,
  };
}
