/**
 * Theme module entry — exports the hook and types.
 *
 * CSS files (tokens.css / theme-dark.css / flowgram-bridge.css) are imported
 * once in src/app.tsx ahead of the editor.
 */
export { useTheme } from './use-theme';
export type { ThemeMode, ResolvedTheme, UseThemeReturn } from './use-theme';
