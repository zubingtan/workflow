/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';
import { CircleAlert } from 'lucide-react';

export const NodeWrapperStyle = styled.div`
  align-items: flex-start;
  background-color: var(--app-color-node-bg);
  border: 1px solid var(--app-color-node-border);
  border-radius: var(--app-radius-md);
  box-shadow: var(--app-shadow-md);
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  width: 360px;
  height: auto;

  &.selected {
    border: 1px solid var(--app-color-primary-active);
  }
`;

export const ErrorIcon = () => (
  <CircleAlert
    size={16}
    style={{
      position: 'absolute',
      color: 'var(--app-color-danger)',
      left: -6,
      top: -6,
      zIndex: 1,
      background: 'var(--app-color-canvas)',
      borderRadius: 8,
    }}
  />
);
