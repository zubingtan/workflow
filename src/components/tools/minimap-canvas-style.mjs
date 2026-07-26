/**
 * Minimap canvasStyle values per theme.
 *
 * Why a separate module: the values are consumed in two places —
 *   1. `useEditorProps` passes the light default to `createMinimapPlugin`
 *      for first-mount initialization.
 *   2. `<Minimap>` component calls `FlowMinimapService.init({ canvasStyle })`
 *      at runtime when the theme switches, without remounting the editor.
 *
 * Kept as a plain `.mjs` module (no type imports) so it can be imported
 * directly by Node tests — same pattern as `theme-controller.mjs` and
 * `new-workflow-template.mjs`. Type safety comes from the TS consumers
 * (`minimap.tsx` / `use-editor-props.tsx`) which annotate the return
 * value as `MinimapCanvasStyle`.
 */

/**
 * Light theme minimap canvasStyle — matches the upstream
 * `MinimapDefaultCanvasStyle` values (rgba light grays) so that first
 * mount looks identical to the pre-theme-support state.
 */
const LIGHT_CANVAS_STYLE = {
  canvasWidth: 182,
  canvasHeight: 102,
  canvasPadding: 50,
  canvasBackground: 'rgba(242, 243, 245, 1)',
  canvasBorderRadius: 10,
  viewportBackground: 'rgba(255, 255, 255, 1)',
  viewportBorderRadius: 4,
  viewportBorderColor: 'rgba(6, 7, 9, 0.10)',
  viewportBorderWidth: 1,
  viewportBorderDashLength: undefined,
  nodeColor: 'rgba(0, 0, 0, 0.10)',
  nodeBorderRadius: 2,
  nodeBorderWidth: 0.145,
  nodeBorderColor: 'rgba(6, 7, 9, 0.10)',
  overlayColor: 'rgba(255, 255, 255, 0.55)',
};

/**
 * Dark theme minimap canvasStyle — dark canvas background, light-on-dark
 * viewport / node / overlay so the minimap matches the dark editor shell.
 */
const DARK_CANVAS_STYLE = {
  canvasWidth: 182,
  canvasHeight: 102,
  canvasPadding: 50,
  canvasBackground: 'rgba(35, 36, 41, 1)',
  canvasBorderRadius: 10,
  viewportBackground: 'rgba(255, 255, 255, 0.08)',
  viewportBorderRadius: 4,
  viewportBorderColor: 'rgba(255, 255, 255, 0.20)',
  viewportBorderWidth: 1,
  viewportBorderDashLength: undefined,
  nodeColor: 'rgba(255, 255, 255, 0.20)',
  nodeBorderRadius: 2,
  nodeBorderWidth: 0.145,
  nodeBorderColor: 'rgba(255, 255, 255, 0.20)',
  overlayColor: 'rgba(0, 0, 0, 0.40)',
};

/**
 * Returns the minimap `canvasStyle` for the given resolved theme.
 *
 * Used by:
 * - `useEditorProps` for first-mount (always 'light' there)
 * - `<Minimap>` component for runtime theme switches
 *   (calls `service.init({ canvasStyle }) + service.render()`)
 *
 * @param {'light' | 'dark'} theme
 */
export function getMinimapCanvasStyle(theme) {
  return theme === 'dark' ? DARK_CANVAS_STYLE : LIGHT_CANVAS_STYLE;
}
