/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef } from 'react';

import { X } from 'lucide-react';
import { NodePanelRenderProps as NodePanelRenderPropsDefault } from '@flowgram.ai/free-node-panel-plugin';
import { WorkflowPortEntity } from '@flowgram.ai/free-layout-editor';

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui';

import { NodePlaceholder } from './node-placeholder';
import { NodeList } from './node-list';

interface NodePanelRenderProps extends NodePanelRenderPropsDefault {
  panelProps?: {
    fromPort?: WorkflowPortEntity;
    enableNodePlaceholder?: boolean;
    enableScrollClose?: boolean;
  };
}

export const NodePanel: React.FC<NodePanelRenderProps> = (props) => {
  const { onSelect, position, onClose, containerNode, panelProps = {} } = props;
  const { enableNodePlaceholder, fromPort } = panelProps;
  const finalFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const activeElement = document.activeElement;
    finalFocusRef.current =
      activeElement instanceof HTMLElement &&
      !activeElement.hasAttribute('disabled') &&
      activeElement.matches(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
        ? activeElement
        : document.querySelector<HTMLElement>('.gedit-playground');
  }, []);
  useEffect(() => {
    if (!panelProps.enableScrollClose) return undefined;
    const handleScroll = () => onClose();
    window.addEventListener('scroll', handleScroll, true);
    return () => window.removeEventListener('scroll', handleScroll, true);
  }, [onClose, panelProps.enableScrollClose]);

  return (
    <Popover open onOpenChange={(open) => !open && onClose()} modal={false}>
      <PopoverTrigger
        render={
          <div
            className="absolute z-40"
            style={
              enableNodePlaceholder
                ? { top: position.y - 61.5, left: position.x, width: 360, height: 100 }
                : { top: position.y, left: position.x, width: 1, height: 1 }
            }
            aria-hidden="true"
          >
            {enableNodePlaceholder && <NodePlaceholder />}
          </div>
        }
      />
      <PopoverContent
        role="dialog"
        aria-label="Add node"
        initialFocus={false}
        finalFocus={() =>
          finalFocusRef.current ?? document.querySelector<HTMLElement>('.gedit-playground')
        }
        side="right"
        align="center"
        sideOffset={30}
        className="w-72 p-2"
        data-node-panel="true"
      >
        <PopoverTitle className="sr-only">Add node</PopoverTitle>
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-xs font-semibold">Add node</span>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close node library">
            <X />
          </Button>
        </div>
        <NodeList
          onSelect={(result) => {
            onSelect(result);
            onClose();
          }}
          containerNode={containerNode}
          fromPort={fromPort}
        />
      </PopoverContent>
    </Popover>
  );
};
