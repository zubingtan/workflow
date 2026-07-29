/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useEffect, startTransition, useContext } from 'react';

import {
  PlaygroundEntityContext,
  useRefresh,
  useClientContext,
} from '@flowgram.ai/free-layout-editor';

import { FlowNodeMeta } from '../../typings';
import { useNodeFormPanel } from '../../plugins/panel-manager-plugin/hooks';
import { IsSidebarContext, IsHistoryViewContext } from '../../context';
import { SidebarNodeRenderer } from './sidebar-node-renderer';

export interface NodeFormPanelProps {
  nodeId: string;
}

export const NodeFormPanel: React.FC<NodeFormPanelProps> = ({ nodeId }) => {
  const { selection, playground, document } = useClientContext();
  const refresh = useRefresh();
  const { close: closePanel } = useNodeFormPanel();
  const isHistoryView = useContext(IsHistoryViewContext);
  const handleClose = useCallback(() => {
    // Sidebar delayed closing
    startTransition(() => {
      closePanel();
    });
  }, []);
  const node = document.getNode(nodeId);
  const sidebarDisabled = node?.getNodeMeta<FlowNodeMeta>()?.sidebarDisabled === true;
  /**
   * Listen readonly
   */
  useEffect(() => {
    const disposable = playground.config.onReadonlyOrDisabledChange(() => {
      // Phase 8 (#160): in history view, readonly is on by design — don't
      // close the sidebar (the user is inspecting a historical snapshot).
      if (isHistoryView) {
        refresh();
        return;
      }
      handleClose();
      refresh();
    });
    return () => disposable.dispose();
  }, [playground, isHistoryView]);
  /**
   * Listen selection
   */
  useEffect(() => {
    const toDispose = selection.onSelectionChanged(() => {
      /**
       * If no node is selected, the sidebar is automatically closed
       */
      if (selection.selection.length === 0) {
        handleClose();
      } else if (selection.selection.length === 1 && selection.selection[0] !== node) {
        handleClose();
      }
    });
    return () => toDispose.dispose();
  }, [selection, node, handleClose]);
  /**
   * Close when node disposed
   */
  useEffect(() => {
    if (node) {
      const toDispose = node.onDispose(() => {
        closePanel();
      });
      return () => toDispose.dispose();
    }
    return () => {};
  }, [node, sidebarDisabled, handleClose]);
  /**
   * Cloze when sidebar disabled
   */
  useEffect(() => {
    // Phase 8 (#160): history view keeps the sidebar open despite readonly.
    if (!node || sidebarDisabled || (playground.config.readonly && !isHistoryView)) {
      handleClose();
    }
  }, [node, sidebarDisabled, playground.config.readonly, isHistoryView]);

  // Phase 8 (#160): in history view the sidebar stays open even though
  // `playground.config.readonly` is true, so the user can inspect node forms
  // (inputs) and the static historical output. The readonly gate still
  // disables all form inputs via `useNodeRenderContext().readonly`.
  if (!node || sidebarDisabled || (playground.config.readonly && !isHistoryView)) {
    return null;
  }

  return (
    <IsSidebarContext.Provider value={true}>
      <PlaygroundEntityContext.Provider key={node.id} value={node}>
        <SidebarNodeRenderer node={node} />
      </PlaygroundEntityContext.Provider>
    </IsSidebarContext.Provider>
  );
};
