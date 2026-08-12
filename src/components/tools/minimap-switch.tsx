/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Button } from '@/components/ui';

import { ToolbarTooltip } from './toolbar-tooltip';
import { UIIconMinimap } from './styles';

export const MinimapSwitch = (props: {
  minimapVisible: boolean;
  setMinimapVisible: (visible: boolean) => void;
}) => (
  <ToolbarTooltip label={props.minimapVisible ? 'Hide minimap' : 'Show minimap'}>
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => props.setMinimapVisible(!props.minimapVisible)}
      aria-label="Minimap"
    >
      <UIIconMinimap $visible={props.minimapVisible} />
    </Button>
  </ToolbarTooltip>
);
