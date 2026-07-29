/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { usePlayground, WorkflowLineEntity } from '@flowgram.ai/free-layout-editor';

import './index.less';

export const useVisible = (params: {
  line: WorkflowLineEntity;
  selected?: boolean;
  hovered?: boolean;
}): boolean => {
  const playground = usePlayground();
  const { line, selected = false, hovered } = params;
  if (line.disposed) {
    // After dispose, reading line.to | line.from would cause ports to be created incorrectly
    return false;
  }
  if (playground.config.readonly) {
    return false;
  }
  if (!selected && !hovered) {
    return false;
  }
  return true;
};
