/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useCallback, useState, type MouseEvent } from 'react';

import { MoreHorizontal } from 'lucide-react';
import {
  delay,
  useClientContext,
  usePlaygroundTools,
  useService,
  WorkflowDragService,
  WorkflowNodeEntity,
  WorkflowSelectService,
} from '@flowgram.ai/free-layout-editor';
import { NodeIntoContainerService } from '@flowgram.ai/free-container-plugin';

import { Button } from '@/components/ui';

import { FlowNodeRegistry } from '../../typings';
import { PasteShortcut } from '../../shortcuts/paste';
import { CopyShortcut } from '../../shortcuts/copy';

interface NodeMenuProps {
  node: WorkflowNodeEntity;
  updateTitleEdit?: (setEditing: boolean) => void;
  deleteNode: () => void;
}

export const NodeMenu: FC<NodeMenuProps> = ({ node, deleteNode, updateTitleEdit }) => {
  const [visible, setVisible] = useState(false);
  const clientContext = useClientContext();
  const registry = node.getNodeRegistry<FlowNodeRegistry>();
  const nodeIntoContainerService = useService(NodeIntoContainerService);
  const selectService = useService(WorkflowSelectService);
  const dragService = useService(WorkflowDragService);
  const tools = usePlaygroundTools();
  const canMoveOut = nodeIntoContainerService.canMoveOutContainer(node);

  const handleMoveOut = useCallback(
    async (event: MouseEvent) => {
      event.stopPropagation();
      const sourceParent = node.parent;
      nodeIntoContainerService.moveOutContainer({ node });
      await delay(16);
      await nodeIntoContainerService.clearInvalidLines({ dragNode: node, sourceParent });
      selectService.selectNode(node);
      dragService.startDragSelectedNodes(event);
      setVisible(false);
    },
    [dragService, node, nodeIntoContainerService, selectService]
  );

  const handleCopy = useCallback(
    (event: MouseEvent) => {
      const copyShortcut = new CopyShortcut(clientContext);
      new PasteShortcut(clientContext).apply(copyShortcut.toClipboardData([node]));
      event.stopPropagation();
      setVisible(false);
    },
    [clientContext, node]
  );

  return (
    <div className="relative">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Node actions"
        onClick={(event) => {
          event.stopPropagation();
          setVisible((current) => !current);
        }}
      >
        <MoreHorizontal />
      </Button>
      {visible && (
        <div
          className="absolute top-full right-0 z-50 mt-1 flex w-40 flex-col rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            size="sm"
            variant="ghost"
            className="justify-start"
            onClick={() => {
              updateTitleEdit?.(true);
              setVisible(false);
            }}
          >
            Edit title
          </Button>
          {canMoveOut && (
            <Button size="sm" variant="ghost" className="justify-start" onClick={handleMoveOut}>
              Move out
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="justify-start"
            disabled={registry.meta.copyDisable === true}
            onClick={handleCopy}
          >
            Create copy
          </Button>
          {registry.meta.isContainer && (
            <Button
              size="sm"
              variant="ghost"
              className="justify-start"
              onClick={() => {
                tools.autoLayout({
                  containerNode: node,
                  enableAnimation: true,
                  animationDuration: 1000,
                  disableFitView: true,
                });
                setVisible(false);
              }}
            >
              Auto layout
            </Button>
          )}
          <Button
            size="sm"
            variant="destructive"
            className="justify-start"
            disabled={!!(registry.canDelete?.(clientContext, node) || registry.meta.deleteDisable)}
            onClick={(event) => {
              deleteNode();
              event.stopPropagation();
              setVisible(false);
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
};
