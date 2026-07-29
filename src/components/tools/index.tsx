/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useContext } from 'react';

import { useRefresh } from '@flowgram.ai/free-layout-editor';
import { useClientContext } from '@flowgram.ai/free-layout-editor';
import { Tooltip, IconButton, Divider, Button } from '@douyinfe/semi-ui';
import { IconUndo, IconRedo, IconHistory } from '@douyinfe/semi-icons';

import { TestRunButton } from '../testrun/testrun-button';
import { AddNode } from '../add-node';
import { ZoomSelect } from './zoom-select';
import { SwitchLine } from './switch-line';
import { ToolContainer, ToolSection } from './styles';
import { Readonly } from './readonly';
import { MinimapSwitch } from './minimap-switch';
import { Minimap } from './minimap';
import { Interactive } from './interactive';
import { FitView } from './fit-view';
import { Comment } from './comment';
import { AutoLayout } from './auto-layout';
import { ProblemButton } from '../problem-panel';
import { DownloadTool } from './download';
import { useWorkflowId } from '../workflow-context';
import { HistoryModal } from '../history-modal';
import { IsHistoryViewContext } from '../../context';

export const DemoTools = () => {
  const { history, playground } = useClientContext();
  const isHistoryView = useContext(IsHistoryViewContext);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  // Phase 7 (#159): History Modal entry from the editor toolbar.
  const workflowId = useWorkflowId();
  const [historyVisible, setHistoryVisible] = useState(false);
  useEffect(() => {
    const disposable = history.undoRedoService.onChange(() => {
      setCanUndo(history.canUndo());
      setCanRedo(history.canRedo());
    });
    return () => disposable.dispose();
  }, [history]);
  const refresh = useRefresh();

  useEffect(() => {
    const disposable = playground.config.onReadonlyOrDisabledChange(() => refresh());
    return () => disposable.dispose();
  }, [playground]);

  return (
    <ToolContainer className="demo-free-layout-tools">
      <ToolSection>
        <Interactive />
        <AutoLayout />
        <SwitchLine />
        <ZoomSelect />
        <FitView />
        <MinimapSwitch minimapVisible={minimapVisible} setMinimapVisible={setMinimapVisible} />
        <Minimap visible={minimapVisible} />
        {/* Phase 8 (#160): hide the Readonly toggle in history view — the
            user must not be able to un-disable edit affordances on a
            historical snapshot. */}
        {!isHistoryView && <Readonly />}
        <Comment />
        <Tooltip content="Undo">
          <IconButton
            type="tertiary"
            theme="borderless"
            icon={<IconUndo />}
            disabled={!canUndo || playground.config.readonly}
            onClick={() => history.undo()}
          />
        </Tooltip>
        <Tooltip content="Redo">
          <IconButton
            type="tertiary"
            theme="borderless"
            icon={<IconRedo />}
            disabled={!canRedo || playground.config.readonly}
            onClick={() => history.redo()}
          />
        </Tooltip>
        <ProblemButton />
        <DownloadTool />
        <Divider layout="vertical" style={{ height: '16px' }} margin={3} />
        <AddNode disabled={playground.config.readonly} />
        <Divider layout="vertical" style={{ height: '16px' }} margin={3} />
        {/* Phase 7 (#159): History entry — to the RIGHT of Add Node per spec.
            Phase 8 (#160): hidden in history view (the viewer is already the
            history detail; reopening the Modal from inside it is a no-op footgun). */}
        {!isHistoryView && (
          <Button
            icon={<IconHistory />}
            color="highlight"
            style={{
              backgroundColor: 'var(--app-color-primary-light-default)',
              borderRadius: 'var(--app-radius-md)',
            }}
            disabled={!workflowId}
            onClick={() => setHistoryVisible(true)}
          >
            History
          </Button>
        )}
        <Divider layout="vertical" style={{ height: '16px' }} margin={3} />
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
