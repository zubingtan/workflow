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

import { Button } from '@/components/ui';

import { NodeList } from '../node-panel/node-list';

export const AddNode = (props: { disabled: boolean }) => {
  const workflowDocument = useService(WorkflowDocument);
  const selectService = useService(WorkflowSelectService);
  const [panelRect, setPanelRect] = useState<DOMRect | null>(null);

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
      setPanelRect(null);
    },
    [getContainerNode, selectService, workflowDocument]
  );

  return (
    <>
      <Button
        data-testid="demo.free-layout.add-node"
        variant="secondary"
        disabled={props.disabled}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPanelRect((current) => (current ? null : rect));
        }}
      >
        <Plus />
        Add Node
      </Button>
      {panelRect && (
        <div
          className="fixed z-[1001] w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md"
          style={{
            left: Math.max(8, Math.min(panelRect.left, window.innerWidth - 296)),
            top: Math.max(8, panelRect.top - 300),
            color: 'var(--app-color-text-1)',
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-xs font-semibold">Add node</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close node library"
              onClick={() => setPanelRect(null)}
            >
              <X />
            </Button>
          </div>
          <NodeList onSelect={handleSelect} containerNode={getContainerNode()} />
        </div>
      )}
    </>
  );
};
