/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';

import { usePlayground, usePlaygroundTools } from '@flowgram.ai/free-layout-editor';
import { IconButton, Tooltip } from '@douyinfe/semi-ui';

import { useLayoutDirection } from '../../hooks/use-layout-direction';
import { IconAutoLayout } from '../../assets/icon-auto-layout';

/**
 * #190: Auto Layout reflows the canvas using the current layout direction
 * (read from `LayoutDirectionContext`). It does NOT rotate port anchors —
 * that is the Layout Direction toggle's job. This lets users re-tidy the
 * layout without flipping anchors (User Story #10).
 */
export const AutoLayout = () => {
  const tools = usePlaygroundTools();
  const playground = usePlayground();
  const { direction } = useLayoutDirection();
  const autoLayout = useCallback(async () => {
    if (playground.config.readonly) {
      console.warn('Auto layout is disabled in readonly mode');
      return;
    }
    await tools.autoLayout({
      enableAnimation: true,
      animationDuration: 1000,
      layoutConfig: {
        rankdir: direction,
        align: undefined,
        nodesep: 100,
        ranksep: 100,
      },
    });
  }, [tools, playground, direction]);

  return (
    <Tooltip content={'Auto Layout'}>
      <IconButton
        disabled={playground.config.readonly}
        type="tertiary"
        theme="borderless"
        onClick={autoLayout}
        icon={IconAutoLayout}
        aria-label="Auto Layout"
      />
    </Tooltip>
  );
};
