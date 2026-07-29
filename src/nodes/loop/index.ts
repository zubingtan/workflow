/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { nanoid } from 'nanoid';
import {
  WorkflowNodeEntity,
  PositionSchema,
  FlowNodeTransformData,
} from '@flowgram.ai/free-layout-editor';

import { FlowNodeRegistry } from '../../typings';
import iconLoop from '../../assets/icon-loop.jpg';
import { formMeta } from './form-meta';
import { WorkflowNodeType } from '../constants';

let index = 0;
export const LoopNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.Loop,
  info: {
    icon: iconLoop,
    description:
      'Used to repeatedly execute a series of tasks by setting the number of iterations and logic.',
  },
  meta: {
    /**
     * Mark as subcanvas
     */
    isContainer: true,
    /**
     * The subcanvas default size setting
     */
    size: {
      width: 424,
      height: 244,
    },
    // autoResizeDisable: true,
    /**
     * The subcanvas padding setting
     */
    padding: (transform) => {
      if (!transform.isContainer) {
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
        };
      }
      return {
        top: 120,
        bottom: 80,
        left: 80,
        right: 80,
      };
    },
    /**
     * Controls the node selection status within the subcanvas
     */
    selectable(node: WorkflowNodeEntity, mousePos?: PositionSchema): boolean {
      if (!mousePos) {
        return true;
      }
      const transform = node.getData<FlowNodeTransformData>(FlowNodeTransformData);
      // Only selectable when the mouse start position is outside the current node's bounds
      return !transform.bounds.contains(mousePos.x, mousePos.y);
    },
    // expandable: false, // disable expanded
    wrapperStyle: {
      minWidth: 'unset',
      width: '100%',
    },
    // defaultPorts: [{ type: 'output', location: 'right' }, { type: 'input', location: 'left'}, { type: 'output', location: 'bottom', portID: 'bottom' }, { type: 'input', location: 'top', portID: 'top'}]
  },
  onAdd() {
    return {
      id: `loop_${nanoid(5)}`,
      type: WorkflowNodeType.Loop,
      data: {
        title: `Loop_${++index}`,
      },
      blocks: [
        {
          id: `block_start_${nanoid(5)}`,
          type: WorkflowNodeType.BlockStart,
          meta: {
            position: {
              x: 32,
              y: 0,
            },
          },
          data: {},
        },
        {
          id: `block_end_${nanoid(5)}`,
          type: WorkflowNodeType.BlockEnd,
          meta: {
            position: {
              x: 192,
              y: 0,
            },
          },
          data: {},
        },
      ],
    };
  },
  formMeta,
};
