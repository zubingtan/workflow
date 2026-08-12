/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';

import { GitBranch } from 'lucide-react';
import { useService, WorkflowLinesManager } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { ToolbarTooltip } from './toolbar-tooltip';

export const SwitchLine = () => {
  const linesManager = useService(WorkflowLinesManager);
  const switchLine = useCallback(() => linesManager.switchLineType(), [linesManager]);
  return (
    <ToolbarTooltip label="Switch line style">
      <Button variant="ghost" size="icon-sm" onClick={switchLine} aria-label="Switch line">
        <GitBranch />
      </Button>
    </ToolbarTooltip>
  );
};
