/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { DockedPanelLayer } from '@flowgram.ai/panel-manager-plugin';
import { EditorRenderer, FreeLayoutEditorProvider } from '@flowgram.ai/free-layout-editor';

import '@flowgram.ai/free-layout-editor/index.css';
import './styles/index.css';
import { FlowDocumentJSON } from './typings';
import type { ResolvedTheme } from './theme';
import { nodeRegistries } from './nodes';
import { useEditorProps } from './hooks';

export const Editor = ({
  data,
  ctxRef,
  resolvedTheme,
  onDirty,
}: {
  data: FlowDocumentJSON;
  ctxRef?: { current: any };
  resolvedTheme: ResolvedTheme;
  onDirty?: () => void;
}) => {
  const editorProps = useEditorProps(data, nodeRegistries, ctxRef, onDirty, resolvedTheme);
  return (
    <div className="doc-free-feature-overview">
      <FreeLayoutEditorProvider key={resolvedTheme} {...editorProps}>
        <div className="demo-container">
          <DockedPanelLayer>
            <EditorRenderer className="demo-editor" />
          </DockedPanelLayer>
        </div>
      </FreeLayoutEditorProvider>
    </div>
  );
};
