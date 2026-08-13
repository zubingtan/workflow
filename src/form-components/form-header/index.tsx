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

function resetMovedPanel(panel: HTMLElement | null) {
  if (!panel?.dataset.panelMoved) return;
  for (const property of [
    'position',
    'left',
    'top',
    'right',
    'bottom',
    'width',
    'height',
    'margin',
    'z-index',
  ]) {
    panel.style.removeProperty(property);
  }
  delete panel.dataset.panelMoved;
}

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
  const handleClose = (event: React.MouseEvent<HTMLButtonElement>) => {
    resetMovedPanel(event.currentTarget.closest<HTMLElement>('.gedit-flow-panel-wrap'));
    closePanel();
  };
  const handlePanelPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!isSidebar || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, [role="button"]')) return;

    const panel = event.currentTarget.closest<HTMLElement>('.gedit-flow-panel-wrap');
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const startLeft = rect.left;
    const startTop = rect.top;
    const startX = event.clientX;
    const startY = event.clientY;

    // FlowGram owns the docked panel size, but a fixed position lets the
    // settings surface follow the user's cursor without changing panel state
    // or the canvas layout. Keep the current dimensions when detaching it.
    panel.style.position = 'fixed';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.width = `${rect.width}px`;
    panel.style.height = `${rect.height}px`;
    panel.style.margin = '0';
    panel.style.zIndex = '1100';
    panel.dataset.panelMoved = 'true';

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    const move = (moveEvent: PointerEvent) => {
      const nextLeft = Math.min(
        Math.max(8, startLeft + moveEvent.clientX - startX),
        Math.max(8, window.innerWidth - rect.width - 8)
      );
      const nextTop = Math.min(
        Math.max(8, startTop + moveEvent.clientY - startY),
        Math.max(8, window.innerHeight - rect.height - 8)
      );
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    };
    const stop = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.body.style.userSelect = previousUserSelect;
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    event.preventDefault();
    event.stopPropagation();
  };
  useEffect(() => {
    // A moved inspector belongs to the previously selected node. Reset the
    // FlowGram wrapper when it is reused for another node so stale fixed
    // coordinates cannot cover the next node card or canvas controls.
    resetMovedPanel(document.querySelector<HTMLElement>('.gedit-flow-panel-wrap'));
    // Collapse loop child nodes
    if (node.flowNodeType === 'loop') {
      toggleLoopExpanded(node, expanded);
    }
  }, [expanded, node.id]);

  return (
    <Header data-node-form-header onPointerDown={handlePanelPointerDown}>
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
