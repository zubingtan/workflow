/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';

import { ChevronDown, ChevronLeft, X } from 'lucide-react';
import { useClientContext, CommandService } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { toggleLoopExpanded } from '../../utils';
import { FlowCommandId } from '../../shortcuts';
import { useNodeFormPanel } from '../../plugins/panel-manager-plugin/hooks';
import { useIsSidebar, useNodeRenderContext } from '../../hooks';
import { NodeMenu } from '../../components/node-menu';
import { getIcon } from './utils';
import { TitleInput } from './title-input';
import { Header, Operators } from './styles';

export function FormHeader() {
  const { node, expanded, toggleExpand, readonly } = useNodeRenderContext();
  const [titleEdit, updateTitleEdit] = useState<boolean>(false);
  const ctx = useClientContext();
  const isSidebar = useIsSidebar();
  const handleExpand = (e: React.MouseEvent) => {
    toggleExpand();
    e.stopPropagation(); // Disable clicking prevents the sidebar from opening
  };
  const { close: closePanel } = useNodeFormPanel();
  const handleDelete = () => {
    ctx.get<CommandService>(CommandService).executeCommand(FlowCommandId.DELETE, [node]);
  };
  const handleClose = () => {
    closePanel();
  };
  useEffect(() => {
    // Collapse loop child nodes
    if (node.flowNodeType === 'loop') {
      toggleLoopExpanded(node, expanded);
    }
  }, [expanded]);

  return (
    <Header>
      {getIcon(node)}
      <TitleInput readonly={readonly} updateTitleEdit={updateTitleEdit} titleEdit={titleEdit} />
      {node.renderData.expandable && !isSidebar && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? 'Collapse node' : 'Expand node'}
          onClick={handleExpand}
        >
          {expanded ? <ChevronDown /> : <ChevronLeft />}
        </Button>
      )}
      {readonly ? undefined : (
        <Operators>
          <NodeMenu node={node} deleteNode={handleDelete} updateTitleEdit={updateTitleEdit} />
        </Operators>
      )}
      {isSidebar && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close node settings"
          onClick={handleClose}
        >
          <X />
        </Button>
      )}
    </Header>
  );
}
