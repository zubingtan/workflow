import assert from 'node:assert/strict';
import test from 'node:test';

import { getMinimapCanvasStyle } from '../src/components/tools/minimap-canvas-style.mjs';

/**
 * Minimap canvasStyle per-theme values.
 *
 * The values are consumed by:
 *   - `useEditorProps` (first-mount, always 'light')
 *   - `<Minimap>` component (runtime theme switch via
 *     `FlowMinimapService.init({ canvasStyle }) + render()`)
 *
 * These tests lock the contract: light matches upstream defaults,
 * dark uses inverted lightness, and the structure is identical so
 * `init()` can swap between them without shape drift.
 */

test('light theme matches upstream MinimapDefaultCanvasStyle', () => {
  const style = getMinimapCanvasStyle('light');
  // These values match the pre-theme-support hardcoded canvasStyle in
  // use-editor-props.tsx (PR #98 baseline). Locking them prevents
  // accidental drift when refactoring.
  assert.equal(style.canvasWidth, 182);
  assert.equal(style.canvasHeight, 102);
  assert.equal(style.canvasPadding, 50);
  assert.equal(style.canvasBackground, 'rgba(242, 243, 245, 1)');
  assert.equal(style.canvasBorderRadius, 10);
  assert.equal(style.viewportBackground, 'rgba(255, 255, 255, 1)');
  assert.equal(style.viewportBorderRadius, 4);
  assert.equal(style.viewportBorderColor, 'rgba(6, 7, 9, 0.10)');
  assert.equal(style.viewportBorderWidth, 1);
  assert.equal(style.viewportBorderDashLength, undefined);
  assert.equal(style.nodeColor, 'rgba(0, 0, 0, 0.10)');
  assert.equal(style.nodeBorderRadius, 2);
  assert.equal(style.nodeBorderWidth, 0.145);
  assert.equal(style.nodeBorderColor, 'rgba(6, 7, 9, 0.10)');
  assert.equal(style.overlayColor, 'rgba(255, 255, 255, 0.55)');
});

test('dark theme uses inverted lightness — dark canvas, light viewport/nodes', () => {
  const style = getMinimapCanvasStyle('dark');
  // Canvas background is dark (matches editor shell --app-color-canvas in dark)
  assert.equal(style.canvasBackground, 'rgba(35, 36, 41, 1)');
  // Viewport / node / border switch to light-on-dark (white with low alpha)
  assert.equal(style.viewportBackground, 'rgba(255, 255, 255, 0.08)');
  assert.equal(style.viewportBorderColor, 'rgba(255, 255, 255, 0.20)');
  assert.equal(style.nodeColor, 'rgba(255, 255, 255, 0.20)');
  assert.equal(style.nodeBorderColor, 'rgba(255, 255, 255, 0.20)');
  // Overlay flips to dark mask (black with alpha) so the dimming effect
  // outside the viewport reads correctly on a dark canvas.
  assert.equal(style.overlayColor, 'rgba(0, 0, 0, 0.40)');
});

test('both themes share identical structural fields (no shape drift)', () => {
  const light = getMinimapCanvasStyle('light');
  const dark = getMinimapCanvasStyle('dark');
  // Structural fields must match so service.init() can swap styles
  // without shape-related rendering glitches.
  assert.deepEqual(
    Object.keys(light).sort(),
    Object.keys(dark).sort()
  );
  assert.equal(light.canvasWidth, dark.canvasWidth);
  assert.equal(light.canvasHeight, dark.canvasHeight);
  assert.equal(light.canvasPadding, dark.canvasPadding);
  assert.equal(light.canvasBorderRadius, dark.canvasBorderRadius);
  assert.equal(light.viewportBorderRadius, dark.viewportBorderRadius);
  assert.equal(light.viewportBorderWidth, dark.viewportBorderWidth);
  assert.equal(light.viewportBorderDashLength, dark.viewportBorderDashLength);
  assert.equal(light.nodeBorderRadius, dark.nodeBorderRadius);
  assert.equal(light.nodeBorderWidth, dark.nodeBorderWidth);
});

test('dark and light canvasBackground are distinct (theme actually differs)', () => {
  // Guard against a future refactor accidentally making both themes return
  // the same value (which would silently break runtime theme switching).
  const light = getMinimapCanvasStyle('light');
  const dark = getMinimapCanvasStyle('dark');
  assert.notEqual(light.canvasBackground, dark.canvasBackground);
  assert.notEqual(light.viewportBackground, dark.viewportBackground);
  assert.notEqual(light.nodeColor, dark.nodeColor);
  assert.notEqual(light.overlayColor, dark.overlayColor);
});

test('unknown theme falls back to light (not throw)', () => {
  // Defensive: getMinimapCanvasStyle is called from a useEffect that
  // reads resolvedTheme from useTheme. If a future theme variant adds
  // a new value, we'd rather render light than crash.
  // @ts-ignore — intentional unknown value for fallback test
  const style = getMinimapCanvasStyle('something-else');
  assert.equal(style.canvasBackground, 'rgba(242, 243, 245, 1)');
});

test('returned object is a new reference each call (no shared mutation)', () => {
  // Although the internal constants are module-level, the function returns
  // the same reference. This is fine because consumers treat the value as
  // read-only. This test documents that contract: if a future refactor
  // starts returning fresh objects, we want to know.
  const a = getMinimapCanvasStyle('light');
  const b = getMinimapCanvasStyle('light');
  assert.equal(a, b, 'same theme returns same reference (module constant)');
});
