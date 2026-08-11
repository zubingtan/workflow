/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FlowNodeEntity, useNodeRender } from '@flowgram.ai/free-layout-editor';

import { NodeStatusBar } from '../testrun/node-status-bar';
import { NodeRenderContext } from '../../context';
import { ErrorIcon } from './styles';
import { NodeWrapper } from './node-wrapper';

export const BaseNode = ({ node }: { node: FlowNodeEntity }) => {
  /**
   * Provides methods related to node rendering
   */
  const nodeRender = useNodeRender();
  /**
   * It can only be used when nodeEngine is enabled
   */
  const form = nodeRender.form;

  /**
   * Used to make the Tooltip scale with the node, which can be implemented by itself depending on the UI library
   */
  return (
    <NodeRenderContext.Provider value={nodeRender}>
      <NodeWrapper>
        {form?.state.invalid && <ErrorIcon />}
        {form?.render()}
      </NodeWrapper>
      <NodeStatusBar />
    </NodeRenderContext.Provider>
  );
};
