/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { DockedPanelLayer } from '@flowgram.ai/panel-manager-plugin';
import { EditorRenderer, FreeLayoutEditorProvider } from '@flowgram.ai/free-layout-editor';

import '@flowgram.ai/free-layout-editor/index.css';
import './styles/index.css';
import { FlowDocumentJSON } from './typings';
import { nodeRegistries } from './nodes';
import { useEditorProps } from './hooks';

export const Editor = ({
  data,
  ctxRef,
  onDirty,
  workflowId,
}: {
  data: FlowDocumentJSON;
  ctxRef?: { current: any };
  onDirty?: () => void;
  workflowId?: string;
}) => {
  const editorProps = useEditorProps(data, nodeRegistries, ctxRef, onDirty, workflowId);
  return (
    <div className="doc-free-feature-overview">
      <FreeLayoutEditorProvider {...editorProps}>
        <div className="demo-container">
          <DockedPanelLayer>
            <EditorRenderer className="demo-editor" />
          </DockedPanelLayer>
        </div>
      </FreeLayoutEditorProvider>
    </div>
  );
};
