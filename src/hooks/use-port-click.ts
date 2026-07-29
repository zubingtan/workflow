/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react';

import {
  WorkflowNodePanelService,
  WorkflowNodePanelUtils,
  type CallNodePanelParams,
  type NodePanelResult,
} from '@flowgram.ai/free-node-panel-plugin';
import {
  delay,
  usePlayground,
  useService,
  WorkflowDocument,
  WorkflowDragService,
  WorkflowLinesManager,
  WorkflowNodeEntity,
  WorkflowNodeJSON,
  WorkflowPortEntity,
} from '@flowgram.ai/free-layout-editor';

/**
 * click port to trigger node select panel
 */
export const usePortClick = () => {
  const playground = usePlayground();
  const nodePanelService = useService(WorkflowNodePanelService);
  const document = useService(WorkflowDocument);
  const dragService = useService(WorkflowDragService);
  const linesManager = useService(WorkflowLinesManager);
  const [active, setActive] = useState(false);

  const singleSelectNodePanel = useCallback(
    async (
      params: Omit<CallNodePanelParams, 'onSelect' | 'onClose' | 'enableMultiAdd'>
    ): Promise<NodePanelResult | undefined> => {
      if (active) {
        return;
      }
      setActive(true);
      return new Promise((resolve) => {
        nodePanelService.callNodePanel({
          ...params,
          enableMultiAdd: false,
          onSelect: async (panelParams?: NodePanelResult) => {
            resolve(panelParams);
          },
          onClose: () => {
            setActive(false);
            resolve(undefined);
          },
        });
      });
    },
    [active]
  );

  const onPortClick = useCallback(
    async (e: React.MouseEvent, port: WorkflowPortEntity) => {
      if (port.portType === 'input') return;
      const mousePos = playground.config.getPosFromMouseEvent(e);
      const containerNode = port.node.parent;
      // open node selection panel
      const result = await singleSelectNodePanel({
        position: mousePos,
        containerNode,
        panelProps: {
          enableScrollClose: true,
          fromPort: port,
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
        position:
          port.location === 'bottom'
            ? {
                x: mousePos.x,
                y: mousePos.y + 100,
              }
            : {
                x: mousePos.x + 100,
                y: mousePos.y,
              },
        fromPort: port,
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
        fromPort: port,
        node,
        linesManager,
      });
    },
    [singleSelectNodePanel]
  );

  return onPortClick;
};
