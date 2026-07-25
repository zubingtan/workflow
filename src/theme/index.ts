/**
 * Theme module entry — exports the hook and types.
 *
 * CSS files (tokens.css / semi-bridge.css / flowgram-bridge.css /
 * theme-dark.css) are imported once in src/app.tsx ahead of the editor —
 * see ADR-0002 for the loading order rationale.
 */
export { useTheme } from './use-theme';
export type { ThemeMode, ResolvedTheme, UseThemeReturn } from './use-theme';
