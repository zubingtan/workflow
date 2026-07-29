/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import {
  WorkflowNodePanelService,
  WorkflowNodePanelUtils,
} from '@flowgram.ai/free-node-panel-plugin';
import {
  delay,
  FreeLayoutPluginContext,
  onDragLineEndParams,
  WorkflowDragService,
  WorkflowLinesManager,
  WorkflowNodeEntity,
  WorkflowNodeJSON,
} from '@flowgram.ai/free-layout-editor';

/**
 * Drag the end of the line to create an add panel (feature optional)
 */
export const onDragLineEnd = async (ctx: FreeLayoutPluginContext, params: onDragLineEndParams) => {
  // get services from context
  const nodePanelService = ctx.get(WorkflowNodePanelService);
  const document = ctx.document;
  const dragService = ctx.get(WorkflowDragService);
  const linesManager = ctx.get(WorkflowLinesManager);

  // get params from drag event
  const { fromPort, toPort, mousePos, line, originLine } = params;

  // return if invalid line state
  if (originLine || !line) {
    return;
  }

  // return if target port exists
  if (toPort || !fromPort) {
    return;
  }

  // get container node for the new node
  const containerNode = fromPort.node.parent;
  const isVertical = fromPort.location === 'bottom';

  // open node selection panel
  const result = await nodePanelService.singleSelectNodePanel({
    position: isVertical
      ? {
          x: mousePos.x - 165,
          y: mousePos.y + 60,
        }
      : mousePos,
    containerNode,
    panelProps: {
      enableNodePlaceholder: true,
      enableScrollClose: true,
      fromPort,
    },
  });

  // return if no node selected
  if (!result) {
    return;
  }

  // get selected node type and data
  const { nodeType, nodeJSON } = result;

  // calculate position for the new node
  const nodePosition = WorkflowNodePanelUtils.adjustNodePosition({
    nodeType,
    position: mousePos,
    fromPort,
    toPort,
    containerNode,
    document,
    dragService,
  });

  // create new workflow node
  const node: WorkflowNodeEntity = document.createWorkflowNodeByType(
    nodeType,
    nodePosition,
    nodeJSON ?? ({} as WorkflowNodeJSON),
    containerNode?.id
  );

  // wait for node render
  await delay(20);

  // build connection line
  WorkflowNodePanelUtils.buildLine({
    fromPort,
    node,
    linesManager,
  });
};
