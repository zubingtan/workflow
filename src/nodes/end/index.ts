/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { WorkflowDocument } from '@flowgram.ai/free-layout-editor';

import { FlowNodeRegistry } from '../../typings';
import iconEnd from '../../assets/icon-end.jpg';
import { formMeta } from './form-meta';
import { WorkflowNodeType } from '../constants';
import { canRemoveEndNodes } from '../../utils/end-node.mjs';

export const EndNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.End,
  meta: {
    copyDisable: true,
    defaultPorts: [{ type: 'input' }],
    size: {
      width: 360,
      height: 211,
    },
  },
  info: {
    icon: iconEnd,
    description:
      'The final node of the workflow, used to return the result information after the workflow is run.',
  },
  /**
   * Render node via formMeta
   */
  formMeta,
  /**
   * Multiple End nodes are allowed (e.g. one per condition branch), but the
   * last remaining End cannot be deleted. The node menu disables its Delete
   * item when this returns `true` (see node-menu `disabled={!!canDelete(...)}`),
   * so we report "blocked" when only one End is left. The delete shortcut
   * enforces the same rule for keyboard deletion.
   */
  canDelete(ctx) {
    const totalEndCount = ctx
      .get(WorkflowDocument)
      .getAllNodes()
      .filter((node) => (node.flowNodeType as WorkflowNodeType) === WorkflowNodeType.End).length;
    return !canRemoveEndNodes(totalEndCount, 1);
  },
};
