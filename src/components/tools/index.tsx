/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useContext, useEffect, useState } from 'react';

import { History, Redo2, Undo2 } from 'lucide-react';
import { useClientContext, useRefresh } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { TestRunButton } from '../testrun/testrun-button';
import { AddNode } from '../add-node';
import { IsHistoryViewContext } from '../../context';
import { ZoomSelect } from './zoom-select';
import { SwitchLine } from './switch-line';
import { ToolContainer, ToolSection } from './styles';
import { Readonly } from './readonly';
import { MinimapSwitch } from './minimap-switch';
import { Minimap } from './minimap';
import { LayoutDirectionSwitch } from './layout-direction';
import { Interactive } from './interactive';
import { FitView } from './fit-view';
import { Comment } from './comment';
import { AutoLayout } from './auto-layout';
import { ProblemButton } from '../problem-panel';
import { DownloadTool } from './download';
import { useWorkflowId } from '../workflow-context';
import { HistoryModal } from '../history-modal';
import { ToolbarTooltip } from './toolbar-tooltip';

export const DemoTools = () => {
  const { history, playground } = useClientContext();
  const isHistoryView = useContext(IsHistoryViewContext);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [historyVisible, setHistoryVisible] = useState(false);
  const workflowId = useWorkflowId();
  const refresh = useRefresh();
  useEffect(() => {
    const dispose = history.undoRedoService.onChange(() => {
      setCanUndo(history.canUndo());
      setCanRedo(history.canRedo());
    });
    return () => dispose.dispose();
  }, [history]);
  useEffect(() => {
    const dispose = playground.config.onReadonlyOrDisabledChange(() => refresh());
    return () => dispose.dispose();
  }, [playground, refresh]);
  return (
    <ToolContainer className="workflow-tools">
      <ToolSection aria-label="Canvas tools">
        <Interactive />
        <AutoLayout />
        <LayoutDirectionSwitch />
        <SwitchLine />
        <ZoomSelect />
        <FitView />
        <MinimapSwitch minimapVisible={minimapVisible} setMinimapVisible={setMinimapVisible} />
        <Minimap visible={minimapVisible} />
        {!isHistoryView && <Readonly />}
        <Comment />
        <ToolbarTooltip label="Undo">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Undo"
            disabled={!canUndo || playground.config.readonly}
            onClick={() => history.undo()}
          >
            <Undo2 />
          </Button>
        </ToolbarTooltip>
        <ToolbarTooltip label="Redo">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Redo"
            disabled={!canRedo || playground.config.readonly}
            onClick={() => history.redo()}
          >
            <Redo2 />
          </Button>
        </ToolbarTooltip>
        <ProblemButton />
        <DownloadTool />
        <span className="mx-1 h-5 w-px bg-border" />
        <AddNode disabled={playground.config.readonly} />
        {!isHistoryView && (
          <Button
            variant="secondary"
            size="sm"
            disabled={!workflowId}
            onClick={() => setHistoryVisible(true)}
          >
            <History data-icon="inline-start" /> History
          </Button>
        )}
        <TestRunButton disabled={playground.config.readonly} />
      </ToolSection>
      <HistoryModal
        workflowId={workflowId}
        visible={historyVisible && workflowId !== null}
        onClose={() => setHistoryVisible(false)}
      />
    </ToolContainer>
  );
};
