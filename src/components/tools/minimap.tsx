/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useEffect } from 'react';

import { MinimapRender, FlowMinimapService } from '@flowgram.ai/minimap-plugin';
import { useClientContext } from '@flowgram.ai/free-layout-editor';

import { useTheme } from '../../theme';
import { MinimapContainer } from './styles';
import { getMinimapCanvasStyle } from './minimap-canvas-style.mjs';

/**
 * Minimap component with runtime theme switching.
 *
 * The minimap is rendered on a 2D canvas — `canvasStyle` is consumed only
 * in `FlowMinimapService.init()` → `initStyle()` (one-shot per init call),
 * so CSS variables can't reach the canvas drawing. Switching themes at
 * runtime therefore requires re-invoking `service.init({ canvasStyle })`
 * (public API) to rebuild `service.style`, then `service.render()` to
 * repaint.
 *
 * This component does NOT remount the editor — `useEditorProps` /
 * `FreeLayoutEditorProvider` are unaware of theme. All runtime state
 * (undo/redo history, scroll position, node selection) is preserved
 * across theme switches.
 */
export const Minimap = ({ visible }: { visible?: boolean }) => {
  const ctx = useClientContext();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!visible) {
      return;
    }
    const service = ctx.get(FlowMinimapService);
    service.init({ canvasStyle: getMinimapCanvasStyle(resolvedTheme) });
    service.render();
  }, [ctx, resolvedTheme, visible]);

  if (!visible) {
    return <></>;
  }
  return (
    <MinimapContainer>
      <MinimapRender
        panelStyles={{}}
        containerStyles={{
          pointerEvents: 'auto',
          position: 'relative',
          top: 'unset',
          right: 'unset',
          bottom: 'unset',
          left: 'unset',
        }}
        inactiveStyle={{
          opacity: 1,
          scale: 1,
          translateX: 0,
          translateY: 0,
        }}
      />
    </MinimapContainer>
  );
};
