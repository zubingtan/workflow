/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';

import { WandSparkles } from 'lucide-react';
import { usePlayground, usePlaygroundTools } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { useLayoutDirection } from '../../hooks/use-layout-direction';

export const AutoLayout = () => {
  const tools = usePlaygroundTools();
  const playground = usePlayground();
  const { direction } = useLayoutDirection();
  const autoLayout = useCallback(async () => {
    if (playground.config.readonly) return;
    await tools.autoLayout({
      enableAnimation: true,
      animationDuration: 1000,
      layoutConfig: { rankdir: direction, align: undefined, nodesep: 100, ranksep: 100 },
    });
  }, [direction, playground, tools]);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={playground.config.readonly}
      onClick={autoLayout}
      aria-label="Auto Layout"
    >
      <WandSparkles />
    </Button>
  );
};
