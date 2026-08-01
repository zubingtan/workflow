/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

/**
 * A workflow may have multiple End nodes (e.g. one per condition branch), but
 * at least one must always remain. Decide whether removing `selectedEndCount`
 * End nodes is allowed given `totalEndCount` End nodes currently present.
 *
 * @param {number} totalEndCount End nodes currently in the document
 * @param {number} selectedEndCount End nodes about to be removed
 * @returns {boolean} true when at least one End node remains after removal
 */
export function canRemoveEndNodes(totalEndCount, selectedEndCount) {
  return totalEndCount - selectedEndCount >= 1;
}
