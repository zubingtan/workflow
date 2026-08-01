/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

/**
 * #190: assign horizontal slots to a condition node's output ports so their
 * left-to-right order matches their target nodes' left-to-right order.
 *
 * In TB (vertical) mode the output ports are distributed across the node's
 * bottom edge. If they are distributed in DOM order while dagre has placed
 * the branch targets in a different left-to-right order, the connection
 * lines cross. Sorting the slot assignment by each port's target x-center
 * removes the crossing.
 *
 * @param {string[]} portIds - output port IDs in DOM order.
 * @param {Map<string, number>|Record<string, number>} targetXs -
 *   portId → target node x-center. A port with no entry is treated as
 *   x = -Infinity (sorts to the front) so unconnected ports stay stable.
 * @returns {Map<string, number>} portId → slot index (0 = leftmost).
 */
export function computePortSlotOrder(portIds, targetXs) {
  const getX = (id) => {
    const x = targetXs instanceof Map ? targetXs.get(id) : targetXs[id];
    return x === undefined ? -Infinity : x;
  };
  const sorted = [...portIds].sort((a, b) => getX(a) - getX(b));
  return new Map(sorted.map((id, index) => [id, index]));
}
