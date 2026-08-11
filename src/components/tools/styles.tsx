/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';

import { IconMinimap } from '../../assets/icon-minimap';

export const ToolContainer = styled.div`
  position: absolute;
  bottom: var(--app-space-4);
  display: flex;
  justify-content: left;
  min-width: 360px;
  pointer-events: none;
  gap: var(--app-space-2);

  z-index: 1000;
`;

export const ToolSection = styled.div`
  display: flex;
  align-items: center;
  background-color: var(--background);
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: var(--shadow-lg);
  column-gap: 2px;
  height: 40px;
  padding: 0 var(--app-space-1);
  pointer-events: auto;
`;

export const SelectZoom = styled.span`
  padding: var(--app-space-1);
  border-radius: var(--app-radius-md);
  border: 1px solid var(--app-color-border);
  font-size: var(--app-font-size-xs);
  width: 50px;
  cursor: pointer;
`;

export const MinimapContainer = styled.div`
  position: absolute;
  bottom: 60px;
  width: 198px;
`;

export const UIIconMinimap = styled(IconMinimap)<{ visible: boolean }>`
  color: ${(props) => (props.visible ? undefined : 'var(--app-color-text-3)')};
`;
