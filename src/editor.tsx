/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { type MutableRefObject } from 'react';

import { IReport } from '@flowgram.ai/runtime-interface';
import { DockedPanelLayer } from '@flowgram.ai/panel-manager-plugin';
import {
  EditorRenderer,
  FreeLayoutEditorProvider,
  type WorkflowContentChangeType,
} from '@flowgram.ai/free-layout-editor';

import '@flowgram.ai/free-layout-editor/index.css';
import './styles/index.css';
import { LayoutDirection } from './utils/rotate-ports';
import { FlowDocumentJSON } from './typings';
import { nodeRegistries } from './nodes';
import { LayoutDirectionProvider, useLayoutDirection } from './hooks/use-layout-direction';
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
  directionRef,
}: {
  data: FlowDocumentJSON;
  ctxRef?: { current: any };
  onDirty?: (eventType?: WorkflowContentChangeType) => void;
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
  /** #190: ref owned by app.tsx that mirrors the current layout direction so
   * `saveWorkflow` can persist it into the workflow JSON. Only the main
   * editor participates in direction switching. */
  directionRef?: MutableRefObject<LayoutDirection>;
}) => {
  const isHistory = !!historyReport || !!liveRunID;
  // #190: the persisted workflow direction seeds LayoutDirectionContext.
  // Absent on legacy workflows → default 'LR' (no behavior change).
  // Only the main editor participates in direction switching; history/live
  // view is readonly and uses the JSON direction only for seed positions
  // (no port rotation, so we don't pass a directionRef to useEditorProps).
  const initialDirection: LayoutDirection = isHistory || !data.direction ? 'LR' : data.direction;

  return (
    <WorkflowIdContext.Provider value={workflowId ?? null}>
      <IsHistoryViewContext.Provider value={isHistory}>
        <LayoutDirectionProvider initialDirection={initialDirection} externalRef={directionRef}>
          <div className="doc-free-feature-overview">
            <FreeLayoutEditorProviderWithDirection
              data={data}
              ctxRef={ctxRef}
              onDirty={onDirty}
              workflowId={workflowId}
              historyReport={historyReport}
              historyRunID={historyRunID}
              liveRunID={liveRunID}
              liveWorkflowId={liveWorkflowId}
              onLiveTerminal={onLiveTerminal}
              isHistory={isHistory}
            />
          </div>
        </LayoutDirectionProvider>
      </IsHistoryViewContext.Provider>
    </WorkflowIdContext.Provider>
  );
};

/**
 * Inner component that runs inside LayoutDirectionProvider so it can read
 * `directionRef` from context and pass it into `useEditorProps` (whose
 * `onInit` registers the ADD_NODE listener + `onLoaded` port-rotation hook).
 */
const FreeLayoutEditorProviderWithDirection = ({
  data,
  ctxRef,
  onDirty,
  workflowId,
  historyReport,
  historyRunID,
  liveRunID,
  liveWorkflowId,
  onLiveTerminal,
  isHistory,
}: {
  data: FlowDocumentJSON;
  ctxRef?: { current: any };
  onDirty?: (eventType?: WorkflowContentChangeType) => void;
  workflowId?: string;
  historyReport?: IReport;
  historyRunID?: string;
  liveRunID?: string;
  liveWorkflowId?: string;
  onLiveTerminal?: () => void;
  isHistory: boolean;
}) => {
  const { directionRef } = useLayoutDirection();
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
      : undefined,
    // #190: only the main editor participates in port rotation.
    isHistory ? undefined : directionRef
  );
  return (
    <FreeLayoutEditorProvider {...editorProps}>
      <div className="demo-container">
        <DockedPanelLayer>
          <EditorRenderer className="demo-editor" />
        </DockedPanelLayer>
      </div>
    </FreeLayoutEditorProvider>
  );
};
