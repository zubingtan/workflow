/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';

import {
  useClientContext,
  usePlayground,
  usePlaygroundTools,
  WorkflowDocument,
} from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { rotateAllPorts, type LayoutDirection } from '../../utils/rotate-ports';
import { fireLayoutSettled } from '../../utils/layout-settled-bus.mjs';
import { useLayoutDirection } from '../../hooks/use-layout-direction';
import { IconLayoutDirection } from '../../assets/icon-layout-direction';

/**
 * #190: Layout Direction Switch. A single toolbar icon button that toggles
 * the canvas layout direction between horizontal ('LR') and vertical ('TB').
 *
 * Clicking the toggle performs, atomically from the user's perspective:
 *  1. `rotateAllPorts` — rotate every main-canvas node's port anchors
 *     (output→bottom/input→top for TB, output→right/input→left for LR).
 *  2. `setDirection` — update `LayoutDirectionContext` (and its ref mirror)
 *     so the condition renderer re-rotates its static input port immediately.
 *  3. `tools.autoLayout` — reflow node positions with the new `rankdir`.
 *  4. `document.fireRender()` — force connection lines to re-render against
 *     the final anchor positions after the animation settles.
 *  5. Persistence — the autoLayout move fires `MOVE_NODE` → `onContentChange`
 *     → `onDirty`, which surfaces the Save button; `saveWorkflow` in app.tsx
 *     reads `directionRef` and writes the `direction` field to the workflow
 *     JSON.
 *
 * Disabled in readonly mode (same gate as AutoLayout). Per-container
 * (right-click) auto-layout is unaffected — only main-canvas ports rotate.
 */
export const LayoutDirectionSwitch = () => {
  const playground = usePlayground();
  const tools = usePlaygroundTools();
  const ctx = useClientContext();
  const { direction, setDirection } = useLayoutDirection();

  const toggle = useCallback(async () => {
    if (playground.config.readonly) {
      return;
    }
    const next: LayoutDirection = direction === 'LR' ? 'TB' : 'LR';
    // 1. Rotate all main-canvas port anchors to the new direction.
    rotateAllPorts(ctx.document as WorkflowDocument, next);
    // 2. Update context state + ref mirror IMMEDIATELY so the condition
    //    renderer's useLayoutEffect fires (updateDynamicPorts + re-rotate
    //    static ports) before the animation starts. Without this, the
    //    condition input port stays at 'left' for the entire 1s animation.
    setDirection(next);
    // 3. Reflow node positions with the new rankdir (1s animation).
    await tools.autoLayout({
      enableAnimation: true,
      animationDuration: 1000,
      layoutConfig: {
        rankdir: next,
        align: undefined,
        nodesep: 100,
        ranksep: 100,
      },
    });
    // 4. Force line re-render so connections pick up the final anchors
    //    after the animation settles.
    ctx.document.fireRender();
    // 5. Notify condition / multi-condition nodes to recompute their output
    //    port slot order against the SETTLED positions. autoLayout interpolates
    //    positions over the animation, so a recompute fired mid-animation can
    //    lock the slots to a transient target order and cross the branch lines
    //    in TB mode; this final recompute removes the crossing.
    fireLayoutSettled();
  }, [playground, tools, ctx, direction, setDirection]);

  const tooltipContent = direction === 'LR' ? 'Layout: Horizontal' : 'Layout: Vertical';

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={playground.config.readonly}
      onClick={toggle}
      title={tooltipContent}
      aria-label={`Layout Direction: ${direction === 'LR' ? 'Horizontal' : 'Vertical'}`}
    >
      <IconLayoutDirection direction={direction} />
    </Button>
  );
};
