/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useNodeRender, FlowNodeEntity } from '@flowgram.ai/free-layout-editor';

import { NodeRenderContext } from '../../context';

export function SidebarNodeRenderer(props: { node: FlowNodeEntity }) {
  const { node } = props;
  const nodeRender = useNodeRender(node);

  return (
    <NodeRenderContext.Provider value={nodeRender}>
      <div
        className="h-full w-full overflow-hidden rounded-xl border border-border bg-background"
        style={{ color: 'var(--app-color-text-1)' }}
      >
        {nodeRender.form?.render()}
      </div>
    </NodeRenderContext.Provider>
  );
}
