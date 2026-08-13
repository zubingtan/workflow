/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState } from 'react';

import { Plus, X } from 'lucide-react';
import type { NodePanelResult } from '@flowgram.ai/free-node-panel-plugin';
import {
  FlowNodeBaseType,
  getAntiOverlapPosition,
  useService,
  WorkflowDocument,
  WorkflowNodeEntity,
  WorkflowNodeJSON,
  WorkflowNodeMeta,
  WorkflowSelectService,
} from '@flowgram.ai/free-layout-editor';

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui';

import { ToolbarTooltip } from '../tools/toolbar-tooltip';
import { NodeList } from '../node-panel/node-list';

export const AddNode = (props: { disabled: boolean }) => {
  const workflowDocument = useService(WorkflowDocument);
  const selectService = useService(WorkflowSelectService);
  const [open, setOpen] = useState(false);

  const getContainerNode = useCallback(() => {
    const activatedNode = selectService.activatedNode;
    if (!activatedNode) return undefined;
    if (activatedNode.getNodeMeta<WorkflowNodeMeta>().isContainer) return activatedNode;
    return activatedNode.parent?.flowNodeType === FlowNodeBaseType.ROOT
      ? undefined
      : activatedNode.parent;
  }, [selectService]);

  const handleSelect = useCallback(
    (panelParams?: NodePanelResult) => {
      if (!panelParams) return;
      const containerNode = getContainerNode();
      const position = containerNode
        ? getAntiOverlapPosition(workflowDocument, { x: 0, y: 200 })
        : undefined;
      const node: WorkflowNodeEntity = workflowDocument.createWorkflowNodeByType(
        panelParams.nodeType,
        position,
        panelParams.nodeJSON ?? ({} as WorkflowNodeJSON),
        containerNode?.id
      );
      selectService.selectNode(node);
    },
    [getContainerNode, selectService, workflowDocument]
  );

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <ToolbarTooltip label="Add node">
        <PopoverTrigger
          render={
            <Button
              data-testid="demo.free-layout.add-node"
              variant="secondary"
              size="sm"
              disabled={props.disabled}
              aria-expanded={open}
              aria-haspopup="dialog"
            >
              <Plus data-icon="inline-start" />
              Add Node
            </Button>
          }
        />
      </ToolbarTooltip>
      <PopoverContent
        role="dialog"
        aria-label="Add node"
        side="top"
        align="center"
        sideOffset={8}
        className="w-72 p-2"
        style={{ color: 'var(--app-color-text-1)' }}
      >
        <PopoverTitle className="sr-only">Add node</PopoverTitle>
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-xs font-semibold">Add node</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Close node library"
            onClick={() => setOpen(false)}
          >
            <X />
          </Button>
        </div>
        <NodeList onSelect={handleSelect} containerNode={getContainerNode()} />
      </PopoverContent>
    </Popover>
  );
};
