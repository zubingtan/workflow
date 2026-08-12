/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';

import { LockKeyhole, Unlock } from 'lucide-react';
import { usePlayground } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { ToolbarTooltip } from './toolbar-tooltip';

export const Readonly = () => {
  const playground = usePlayground();
  const toggleReadonly = useCallback(() => {
    playground.config.readonly = !playground.config.readonly;
  }, [playground]);
  const label = playground.config.readonly ? 'Switch to editable' : 'Switch to readonly';
  return (
    <ToolbarTooltip label={label}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={playground.config.readonly ? 'Editable' : 'Readonly'}
        onClick={toggleReadonly}
      >
        {playground.config.readonly ? <LockKeyhole /> : <Unlock />}
      </Button>
    </ToolbarTooltip>
  );
};
