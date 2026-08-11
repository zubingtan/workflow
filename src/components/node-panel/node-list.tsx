import React, { FC } from 'react';

import { NodePanelRenderProps } from '@flowgram.ai/free-node-panel-plugin';
import {
  useClientContext,
  WorkflowNodeEntity,
  WorkflowPortEntity,
} from '@flowgram.ai/free-layout-editor';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';

import { canContainNode } from '../../utils';
import { FlowNodeRegistry } from '../../typings';
import { nodeRegistries } from '../../nodes';

interface NodeListProps {
  onSelect: NodePanelRenderProps['onSelect'];
  fromPort?: WorkflowPortEntity;
  containerNode?: WorkflowNodeEntity;
}

export const NodeList: FC<NodeListProps> = ({ onSelect, containerNode }) => {
  const context = useClientContext();
  const handleClick = (event: React.MouseEvent, registry: FlowNodeRegistry) => {
    onSelect({
      nodeType: registry.type as string,
      selectEvent: event,
      nodeJSON: registry.onAdd?.(context),
    });
  };

  return (
    <div className="grid max-h-80 grid-cols-2 gap-1 overflow-auto">
      {nodeRegistries
        .filter((registry) => registry.meta.nodePanelVisible !== false)
        .filter((registry) => {
          if (registry.meta.onlyInContainer)
            return registry.meta.onlyInContainer === containerNode?.flowNodeType;
          return !containerNode || canContainNode(registry.type, containerNode.flowNodeType);
        })
        .map((registry) => {
          const disabled = !(registry.canAdd?.(context) ?? true);
          return (
            <Button
              key={registry.type}
              data-testid={`demo-free-node-list-${registry.type}`}
              className={cn(
                'h-auto min-h-10 justify-start gap-2 px-2 text-left text-xs',
                disabled && 'opacity-40'
              )}
              variant="ghost"
              disabled={disabled}
              onClick={(event) => handleClick(event, registry)}
            >
              <img className="size-5 rounded-md object-cover" src={registry.info?.icon} alt="" />
              <span className="truncate">{registry.type as string}</span>
            </Button>
          );
        })}
    </div>
  );
};
