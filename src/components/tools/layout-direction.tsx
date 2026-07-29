/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';

import { usePlayground } from '@flowgram.ai/free-layout-editor';
import { IconButton, Tooltip } from '@douyinfe/semi-ui';

import { IconLayoutDirection, LayoutDirection } from '../../assets/icon-layout-direction';

/**
 * Layout Direction Switch — toggles the auto-layout reflow direction
 * between horizontal ('LR') and vertical ('TB'). The direction state is
 * owned by the parent toolbar (DemoTools) and shared with the AutoLayout
 * button. Clicking this toggle does NOT reflow the canvas; it only
 * selects the direction the next Auto Layout click will use.
 *
 * Mirrors the MinimapSwitch pattern: borderless IconButton + Tooltip,
 * state lifted into the parent. Disabled in readonly mode, matching
 * the AutoLayout button's readonly gate.
 */
export const LayoutDirectionSwitch = (props: {
  direction: LayoutDirection;
  setDirection: (direction: LayoutDirection) => void;
}) => {
  const { direction, setDirection } = props;
  const playground = usePlayground();
  const toggle = useCallback(() => {
    setDirection(direction === 'LR' ? 'TB' : 'LR');
  }, [direction, setDirection]);

  const tooltipContent = direction === 'LR' ? 'Layout: Horizontal' : 'Layout: Vertical';

  return (
    <Tooltip content={tooltipContent}>
      <IconButton
        disabled={playground.config.readonly}
        type="tertiary"
        theme="borderless"
        onClick={toggle}
        icon={<IconLayoutDirection direction={direction} />}
        aria-label={`Layout Direction: ${direction === 'LR' ? 'Horizontal' : 'Vertical'}`}
      />
    </Tooltip>
  );
};
