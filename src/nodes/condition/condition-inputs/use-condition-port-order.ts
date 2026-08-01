/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useLayoutEffect, useState } from 'react';

import type { WorkflowNodeEntity } from '@flowgram.ai/free-layout-editor';

import { computePortSlotOrder } from '../../../utils/port-slot-order.mjs';
import { onLayoutSettled } from '../../../utils/layout-settled-bus.mjs';

/**
 * #190: reactive ordering of a condition / multi-condition node's output
 * ports by their target nodes' x-position, so the ports' horizontal slot
 * order always matches the targets' left-to-right order (branch lines don't
 * cross in TB mode).
 *
 * Recomputes on FlowGram `onContentChange` — which fires for edge
 * add/remove/reconnect, branch add/remove, and node moves (manual drag and
 * autoLayout's MOVE_NODE). The compute is debounced so a burst of move
 * events during an autoLayout animation collapses into a single update once
 * positions settle.
 *
 * It ALSO recomputes on `onLayoutSettled` (fired by the Layout Direction
 * toggle after `await autoLayout` resolves). autoLayout interpolates node
 * positions over the animation, so a recompute that fires mid-animation can
 * read a transient target order; the settled notification guarantees a final
 * recompute against settled positions, keeping TB branch lines uncrossed.
 */
export function useConditionPortOrder(
  node: WorkflowNodeEntity,
  portIds: string[]
): Map<string, number> {
  // portIds identity changes every render; a joined key is a stable,
  // honest dependency. The effect derives the id list from the key.
  const portKey = portIds.join('|');
  const [order, setOrder] = useState<Map<string, number>>(() =>
    computePortSlotOrder(portIds, new Map())
  );

  useLayoutEffect(() => {
    const ids = portKey === '' ? [] : portKey.split('|');
    let timer: number | undefined;
    const compute = () => {
      const targetXs = new Map<string, number>();
      for (const line of node.lines.outputLines) {
        const fromPort = (line as any).info?.fromPort;
        const toId = (line as any).to?.id;
        if (!fromPort || !toId) continue;
        const el = globalThis.document.querySelector(`[data-node-id="${toId}"]`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        targetXs.set(String(fromPort), rect.x + rect.width / 2);
      }
      setOrder(computePortSlotOrder(ids, targetXs));
    };
    const debounced = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(compute, 100);
    };
    compute();
    const disposable = (node.document as any).onContentChange?.(debounced);
    // Re-run once the Layout Direction toggle's autoLayout animation settles
    // (debounced, so the DOM has reflected the final positions). Without this,
    // a compute that fired mid-animation locks the slots to a transient order.
    const unsubscribeSettled = onLayoutSettled(debounced);
    return () => {
      window.clearTimeout(timer);
      disposable?.dispose?.();
      unsubscribeSettled();
    };
  }, [node, portKey]);

  return order;
}
