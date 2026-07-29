/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import {
  FlowNodeBaseType,
  WorkflowDocument,
  WorkflowNodeEntity,
  WorkflowNodeMeta,
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
 * Whether a node lives inside a sub-canvas (loop / group container).
 * Sub-canvas nodes are skipped by #190: only main-canvas ports rotate.
 * Mirrors the `FlowNodeBaseType.ROOT` gate used in `use-add-node.ts`.
 */
export function isSubCanvasNode(node: WorkflowNodeEntity): boolean {
  const parent = node.parent;
  return !!parent && parent.flowNodeType !== FlowNodeBaseType.ROOT;
}

/**
 * Rotate every main-canvas node's static ports to match `direction`.
 * Skips:
 *  - sub-canvas interior nodes (`isSubCanvasNode`)
 *  - dynamic-port nodes (condition / multi-condition) whose ports are
 *    DOM-driven and would be overwritten by `updateDynamicPorts()`.
 *
 * `port.update({ location })` is the public FlowGram API
 * (free-layout-core/dist/index.js — `WorkflowPortEntity.update`); it writes
 * `_location` and fires `fireChange()`, and `relativePosition` / `point`
 * recompute automatically.
 */
export function rotateAllPorts(document: WorkflowDocument, direction: LayoutDirection): void {
  for (const node of document.getAllNodes()) {
    if (isSubCanvasNode(node)) continue;
    const meta = node.getNodeMeta<WorkflowNodeMeta>();
    if (meta.useDynamicPort) continue;
    for (const port of node.ports.allPorts) {
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
 * Same skip rules as `rotateAllPorts` (sub-canvas + dynamic ports).
 */
export function rotateNodePorts(node: WorkflowNodeEntity, direction: LayoutDirection): void {
  if (isSubCanvasNode(node)) return;
  const meta = node.getNodeMeta<WorkflowNodeMeta>();
  if (meta.useDynamicPort) return;
  for (const port of node.ports.allPorts) {
    const newLocation = rotatePortLocation(port.portType, direction);
    if (port.location !== newLocation) {
      port.update({ location: newLocation } as any);
    }
  }
}
