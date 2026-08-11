/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FunctionComponent } from 'react';

import { Copy, Expand, Minimize2, Trash2 } from 'lucide-react';
import { SelectorBoxPopoverProps } from '@flowgram.ai/free-layout-editor';
import { WorkflowGroupCommand } from '@flowgram.ai/free-group-plugin';

import { Button } from '@/components/ui';

import { IconGroup } from '../group';
import { FlowCommandId } from '../../shortcuts/constants';

export const SelectorBoxPopover: FunctionComponent<SelectorBoxPopoverProps> = ({
  bounds,
  children,
  commandRegistry,
}) => (
  <>
    <div
      className="absolute z-30 flex -translate-x-full -translate-y-full gap-1 rounded-lg border border-border bg-background p-1 shadow-lg"
      style={{ left: bounds.right, top: bounds.top }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Button
        size="icon-sm"
        aria-label="Collapse"
        onMouseDown={() => commandRegistry.executeCommand(FlowCommandId.COLLAPSE)}
      >
        <Minimize2 />
      </Button>
      <Button
        size="icon-sm"
        aria-label="Expand"
        onMouseDown={() => commandRegistry.executeCommand(FlowCommandId.EXPAND)}
      >
        <Expand />
      </Button>
      <Button
        size="icon-sm"
        aria-label="Create group"
        onClick={() => commandRegistry.executeCommand(WorkflowGroupCommand.Group)}
      >
        <IconGroup size={14} />
      </Button>
      <Button
        size="icon-sm"
        aria-label="Copy"
        onClick={() => commandRegistry.executeCommand(FlowCommandId.COPY)}
      >
        <Copy />
      </Button>
      <Button
        size="icon-sm"
        variant="destructive"
        aria-label="Delete"
        onClick={() => commandRegistry.executeCommand(FlowCommandId.DELETE)}
      >
        <Trash2 />
      </Button>
    </div>
    <div>{children}</div>
  </>
);
