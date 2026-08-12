/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useRef } from 'react';

import { X } from 'lucide-react';
import { NodePanelRenderProps as NodePanelRenderPropsDefault } from '@flowgram.ai/free-node-panel-plugin';
import { WorkflowPortEntity } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { NodePlaceholder } from './node-placeholder';
import { NodeList } from './node-list';

interface NodePanelRenderProps extends NodePanelRenderPropsDefault {
  panelProps?: {
    fromPort?: WorkflowPortEntity;
    enableNodePlaceholder?: boolean;
  };
}

export const NodePanel: React.FC<NodePanelRenderProps> = (props) => {
  const { onSelect, position, onClose, containerNode, panelProps = {} } = props;
  const { enableNodePlaceholder, fromPort } = panelProps;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const handleScroll = () => onClose();
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-40"
      style={{ top: position.y, left: position.x }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {enableNodePlaceholder && <NodePlaceholder />}
      <div className="mt-2 w-72 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md">
        <div className="flex items-center justify-between px-2 pb-2">
          <span className="text-xs font-semibold">Add node</span>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close node library">
            <X />
          </Button>
        </div>
        <NodeList onSelect={onSelect} containerNode={containerNode} fromPort={fromPort} />
      </div>
    </div>
  );
};
