/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useCallback, useRef, useState, type MouseEvent } from 'react';

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
import { Menu } from '@base-ui/react/menu';

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
  const suppressFocusOpen = useRef(false);
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
    },
    [dragService, node, nodeIntoContainerService, selectService]
  );

  const handleCopy = useCallback(
    (event: MouseEvent) => {
      const copyShortcut = new CopyShortcut(clientContext);
      new PasteShortcut(clientContext).apply(copyShortcut.toClipboardData([node]));
      event.stopPropagation();
    },
    [clientContext, node]
  );

  return (
    <Menu.Root
      open={visible}
      onOpenChange={(open) => {
        setVisible(open);
        if (!open) {
          suppressFocusOpen.current = true;
        }
      }}
      modal={false}
    >
      <Menu.Trigger
        openOnHover
        closeDelay={0}
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Node actions"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onMouseLeave={() => {
              suppressFocusOpen.current = false;
            }}
          />
        }
        onFocus={() => {
          if (suppressFocusOpen.current) {
            suppressFocusOpen.current = false;
          } else {
            setVisible(true);
          }
        }}
      >
        <MoreHorizontal />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="isolate z-[1200]">
          <Menu.Popup
            finalFocus
            className="flex w-40 flex-col gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
            onClick={(event) => event.stopPropagation()}
          >
            <Menu.Item
              className="flex h-7 cursor-default items-center rounded-md px-2.5 text-[0.8rem] outline-none hover:bg-accent hover:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              onClick={() => updateTitleEdit?.(true)}
            >
              Edit title
            </Menu.Item>
            {canMoveOut && (
              <Menu.Item
                className="flex h-7 cursor-default items-center rounded-md px-2.5 text-[0.8rem] outline-none hover:bg-accent hover:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                onClick={handleMoveOut}
              >
                Move out
              </Menu.Item>
            )}
            <Menu.Item
              className="flex h-7 cursor-default items-center rounded-md px-2.5 text-[0.8rem] outline-none hover:bg-accent hover:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
              disabled={registry.meta.copyDisable === true}
              onClick={handleCopy}
            >
              Create copy
            </Menu.Item>
            {registry.meta.isContainer && (
              <Menu.Item
                className="flex h-7 cursor-default items-center rounded-md px-2.5 text-[0.8rem] outline-none hover:bg-accent hover:text-accent-foreground data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                onClick={() =>
                  tools.autoLayout({
                    containerNode: node,
                    enableAnimation: true,
                    animationDuration: 1000,
                    disableFitView: true,
                  })
                }
              >
                Auto layout
              </Menu.Item>
            )}
            <Menu.Item
              className="flex h-7 cursor-default items-center rounded-md px-2.5 text-[0.8rem] text-destructive outline-none hover:bg-destructive/10 data-highlighted:bg-destructive/10"
              disabled={
                !!(registry.canDelete?.(clientContext, node) || registry.meta.deleteDisable)
              }
              onClick={(event) => {
                deleteNode();
                event.stopPropagation();
              }}
            >
              Delete
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};
