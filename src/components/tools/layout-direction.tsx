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
import { IconButton, Tooltip } from '@douyinfe/semi-ui';

import { rotateAllPorts, type LayoutDirection } from '../../utils/rotate-ports';
import { useLayoutDirection } from '../../hooks/use-layout-direction';
import { IconLayoutDirection } from '../../assets/icon-layout-direction';

/**
 * #190: Layout Direction Switch. A single toolbar icon button that toggles
 * the canvas layout direction between horizontal ('LR') and vertical ('TB').
 *
 * Clicking the toggle performs, atomically from the user's perspective:
 *  1. `rotateAllPorts` — rotate every main-canvas node's port anchors
 *     (output→bottom/input→top for TB, output→right/input→left for LR).
 *  2. `tools.autoLayout` — reflow node positions with the new `rankdir`.
 *  3. `document.fireRender()` — force connection lines to re-render against
 *     the new anchor positions (the `@observeEntities(WorkflowPortEntity)`
 *     → line update chain is unproven, so we trigger manually).
 *  4. `setDirection` — update `LayoutDirectionContext` (and its ref mirror).
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
    // 2. Reflow node positions with the new rankdir (1s animation).
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
    // 3. Force line re-render so connections pick up the new anchors.
    ctx.document.fireRender();
    // 4. Update context state + ref mirror (ref is read by the ADD_NODE
    //    listener in useEditorProps to rotate newly-added nodes' ports).
    setDirection(next);
  }, [playground, tools, ctx, direction, setDirection]);

  const tooltipContent = direction === 'LR' ? 'Layout: Horizontal' : 'Layout: Vertical';

  return (
    <Tooltip content={tooltipContent}>
      <IconButton
        disabled={playground.config.readonly}
        type="tertiary"
        theme="borderless"
        onClick={toggle}
        icon={<IconLayoutDirection direction={direction} />}
        aria-label={`Layout Direction: ${direction === 'LR' ? 'Horizontal' : 'Vertical'}`}
      />
    </Tooltip>
  );
};
