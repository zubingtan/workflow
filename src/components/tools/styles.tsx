/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';
import { Map } from 'lucide-react';

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
  background-color: color-mix(in oklch, var(--card) 78%, transparent);
  border: 1px solid var(--border);
  border-radius: var(--app-radius-lg);
  box-shadow: var(--app-shadow-lg);
  backdrop-filter: blur(12px);
  column-gap: var(--app-space-1);
  height: 40px;
  padding: 0 var(--app-space-1);
  pointer-events: auto;
`;

export const MinimapContainer = styled.div`
  position: absolute;
  bottom: 60px;
  width: 198px;
`;

export const UIIconMinimap = styled(Map)<{ $visible: boolean }>`
  color: ${(props) => (props.$visible ? undefined : 'var(--app-color-text-3)')};
`;
