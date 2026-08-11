/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Button } from '@/components/ui';

import { UIIconMinimap } from './styles';

export const MinimapSwitch = (props: {
  minimapVisible: boolean;
  setMinimapVisible: (visible: boolean) => void;
}) => (
  <Button
    variant="ghost"
    size="icon-sm"
    onClick={() => props.setMinimapVisible(!props.minimapVisible)}
    aria-label="Minimap"
  >
    <UIIconMinimap visible={props.minimapVisible} />
  </Button>
);
