/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import {
  FlowNodeBaseType,
  WorkflowDocument,
  WorkflowNodeEntity,
  WorkflowPortEntity,
} from '@flowgram.ai/free-layout-editor';

/**
 * #190: canvas layout direction. Matches dagre's `rankdir` enum exactly;
 * `'BT'` / `'RL'` are intentionally excluded.
 */
export type LayoutDirection = 'LR' | 'TB';

/**
 * Map a port type + direction to the anchor location FlowGram expects.
 * - LR (horizontal): output on the right, input on the left.
 * - TB (vertical):   output on the bottom, input on the top.
 */
export function rotatePortLocation(
  portType: 'input' | 'output',
  direction: LayoutDirection
): 'left' | 'right' | 'top' | 'bottom' {
  if (direction === 'TB') {
    return portType === 'output' ? 'bottom' : 'top';
  }
  return portType === 'output' ? 'right' : 'left';
}

/**
 * Type guard: whether a port is DOM-driven (has a `targetElement` set by
 * `updateDynamicPorts()`). Such ports are skipped by `rotateAllPorts` /
 * `rotateNodePorts` because their position is controlled by CSS +
 * `data-port-location` in the renderer, not by `port.update()`.
 */
export function hasTargetElement(port: WorkflowPortEntity): boolean {
  return !!port.targetElement;
}

/**
 * Whether a node lives inside a sub-canvas (loop / group container).
 * Sub-canvas nodes are skipped by #190: only main-canvas ports rotate.
 * Mirrors the `FlowNodeBaseType.ROOT` gate used by the editor add-node action.
 */
export function isSubCanvasNode(node: WorkflowNodeEntity): boolean {
  const parent = node.parent;
  return !!parent && parent.flowNodeType !== FlowNodeBaseType.ROOT;
}

/**
 * Rotate every main-canvas node's static ports to match `direction`.
 * Skips:
 *  - sub-canvas interior nodes (`isSubCanvasNode`)
 *  - dynamic ports (those with a `targetElement` - i.e. condition /
 *    multi-condition output ports that are DOM-driven and would be
 *    overwritten by `updateDynamicPorts()`). Their rotation is handled
 *    in the renderer via CSS + `data-port-location` (see spec #190
 *    "Module: condition node renderer direction-awareness").
 *
 * Note: condition nodes' static INPUT port has no `targetElement` and IS
 * rotated here (it falls back to the `switch(location)` anchor path).
 *
 * `port.update({ location })` is the public FlowGram API
 * (free-layout-core/dist/index.js - `WorkflowPortEntity.update`); it writes
 * `_location` and fires `fireChange()`, and `relativePosition` / `point`
 * recompute automatically.
 */
export function rotateAllPorts(document: WorkflowDocument, direction: LayoutDirection): void {
  for (const node of document.getAllNodes()) {
    if (isSubCanvasNode(node)) continue;
    for (const port of node.ports.allPorts) {
      // Skip dynamic ports (DOM-driven). Their `targetElement` is set by
      // `updateDynamicPorts()` from `[data-port-id]` DOM elements; calling
      // `port.update()` on them gets overwritten on the next size change.
      if (hasTargetElement(port)) continue;
      const newLocation = rotatePortLocation(port.portType, direction);
      if (port.location !== newLocation) {
        port.update({ location: newLocation } as any);
      }
    }
  }
}

/**
 * Rotate a single node's static ports to match `direction` (used by the
 * ADD_NODE listener so newly-added nodes inherit the current direction).
 * Same skip rules as `rotateAllPorts` (sub-canvas + dynamic ports with
 * `targetElement`).
 */
export function rotateNodePorts(node: WorkflowNodeEntity, direction: LayoutDirection): void {
  if (isSubCanvasNode(node)) return;
  for (const port of node.ports.allPorts) {
    if (hasTargetElement(port)) continue;
    const newLocation = rotatePortLocation(port.portType, direction);
    if (port.location !== newLocation) {
      port.update({ location: newLocation } as any);
    }
  }
}
