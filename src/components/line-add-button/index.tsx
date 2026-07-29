/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';

import {
  WorkflowNodePanelService,
  WorkflowNodePanelUtils,
} from '@flowgram.ai/free-node-panel-plugin';
import { LineRenderProps } from '@flowgram.ai/free-lines-plugin';
import {
  delay,
  HistoryService,
  useService,
  WorkflowDocument,
  WorkflowDragService,
  WorkflowLinesManager,
  WorkflowNodeEntity,
  WorkflowNodeJSON,
} from '@flowgram.ai/free-layout-editor';

import './index.less';
import { useVisible } from './use-visible';
import { IconPlusCircle } from './button';

export const LineAddButton = (props: LineRenderProps) => {
  const { line, selected, hovered, color } = props;
  const visible = useVisible({ line, selected, hovered });
  const nodePanelService = useService<WorkflowNodePanelService>(WorkflowNodePanelService);
  const document = useService(WorkflowDocument);
  const dragService = useService(WorkflowDragService);
  const linesManager = useService(WorkflowLinesManager);
  const historyService = useService(HistoryService);

  const { fromPort, toPort } = line;

  const onClick = useCallback(async () => {
    // calculate the middle point of the line
    const position = {
      x: (line.position.from.x + line.position.to.x) / 2,
      y: (line.position.from.y + line.position.to.y) / 2,
    };

    // get container node for the new node
    const containerNode = fromPort!.node.parent;

    // show node selection panel
    const result = await nodePanelService.singleSelectNodePanel({
      position,
      containerNode,
      panelProps: {
        enableScrollClose: true,
        fromPort,
      },
    });
    if (!result) {
      return;
    }

    const { nodeType, nodeJSON } = result;

    // adjust position for the new node
    const nodePosition = WorkflowNodePanelUtils.adjustNodePosition({
      nodeType,
      position,
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

    // auto offset subsequent nodes
    if (fromPort && toPort) {
      WorkflowNodePanelUtils.subNodesAutoOffset({
        node,
        fromPort,
        toPort,
        containerNode,
        historyService,
        dragService,
        linesManager,
      });
    }

    // wait for node render
    await delay(20);

    // build connection lines
    WorkflowNodePanelUtils.buildLine({
      fromPort,
      node,
      toPort,
      linesManager,
    });

    // remove original line
    line.dispose();
  }, []);

  if (!visible) {
    return <></>;
  }

  return (
    <div
      className="line-add-button"
      style={{
        transform: `translate(-50%, -50%) translate(${line.center.labelX}px, ${line.center.labelY}px)`,
        color,
      }}
      data-testid="sdk.workflow.canvas.line.add"
      data-line-id={line.id}
      onClick={onClick}
    >
      <IconPlusCircle />
    </div>
  );
};
