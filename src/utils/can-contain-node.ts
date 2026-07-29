/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { type FlowNodeType } from '@flowgram.ai/free-layout-editor';

import { WorkflowNodeType } from '../nodes';

/**
 * Determine whether the parent node can contain the corresponding child node
 * @param childNodeType
 * @param parentNodeType
 */
export function canContainNode(
  childNodeType: WorkflowNodeType | FlowNodeType,
  parentNodeType: WorkflowNodeType | FlowNodeType
) {
  /**
   * The start and end nodes cannot change container
   */
  if (
    [
      WorkflowNodeType.Start,
      WorkflowNodeType.End,
      WorkflowNodeType.BlockStart,
      WorkflowNodeType.BlockEnd,
    ].includes(childNodeType as WorkflowNodeType)
  ) {
    return false;
  }
  /**
   * Continue loop and break loop can only be in loop nodes
   */
  if (
    [WorkflowNodeType.Continue, WorkflowNodeType.Break].includes(
      childNodeType as WorkflowNodeType
    ) &&
    parentNodeType !== WorkflowNodeType.Loop
  ) {
    return false;
  }
  /**
   * Loop node cannot nest loop node
   */
  if (childNodeType === WorkflowNodeType.Loop && parentNodeType === WorkflowNodeType.Loop) {
    return false;
  }
  return true;
}
