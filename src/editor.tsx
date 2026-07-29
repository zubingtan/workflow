/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { IReport } from '@flowgram.ai/runtime-interface';
import { DockedPanelLayer } from '@flowgram.ai/panel-manager-plugin';
import { EditorRenderer, FreeLayoutEditorProvider } from '@flowgram.ai/free-layout-editor';

import '@flowgram.ai/free-layout-editor/index.css';
import './styles/index.css';
import { FlowDocumentJSON } from './typings';
import { nodeRegistries } from './nodes';
import { useEditorProps } from './hooks';
import { IsHistoryViewContext } from './context';
import { WorkflowIdContext } from './components/workflow-context';

export const Editor = ({
  data,
  ctxRef,
  onDirty,
  workflowId,
  historyReport,
  historyRunID,
  liveRunID,
  liveWorkflowId,
  onLiveTerminal,
}: {
  data: FlowDocumentJSON;
  ctxRef?: { current: any };
  onDirty?: () => void;
  workflowId?: string;
  /** Phase 8 (#160): terminal report for the history view. When present, the
   * editor renders readonly with StaticHistoryRuntimeService. */
  historyReport?: IReport;
  historyRunID?: string;
  /** #181: live-running run ID. When present (and no historyReport), the
   * editor renders readonly with LiveHistoryRuntimeService subscribed to SSE. */
  liveRunID?: string;
  liveWorkflowId?: string;
  /** #182: callback invoked when the live SSE stream delivers run_terminal.
   * The ReadonlyViewer uses this to refetch + remount in static mode without
   * opening a second SSE connection (HTTP/1.1 connection exhaustion fix). */
  onLiveTerminal?: () => void;
}) => {
  const editorProps = useEditorProps(
    data,
    nodeRegistries,
    ctxRef,
    onDirty,
    workflowId,
    liveRunID
      ? { liveRunID, liveWorkflowId, onLiveTerminal }
      : historyReport
      ? { historyReport, historyRunID }
      : undefined
  );
  const isHistory = !!historyReport || !!liveRunID;
  return (
    <WorkflowIdContext.Provider value={workflowId ?? null}>
      <IsHistoryViewContext.Provider value={isHistory}>
        <div className="doc-free-feature-overview">
          <FreeLayoutEditorProvider {...editorProps}>
            <div className="demo-container">
              <DockedPanelLayer>
                <EditorRenderer className="demo-editor" />
              </DockedPanelLayer>
            </div>
          </FreeLayoutEditorProvider>
        </div>
      </IsHistoryViewContext.Provider>
    </WorkflowIdContext.Provider>
  );
};
