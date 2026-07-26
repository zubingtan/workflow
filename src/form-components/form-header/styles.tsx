/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';

export const Header = styled.div`
  box-sizing: border-box;
  display: flex;
  justify-content: flex-start;
  align-items: center;
  width: 100%;
  column-gap: var(--app-space-2);
  border-radius: var(--app-radius-md) var(--app-radius-md) 0 0;
  cursor: move;

  background: linear-gradient(var(--app-color-node-header-from) 0%, var(--app-color-surface) 100%);
  overflow: hidden;

  padding: var(--app-space-2);
`;

export const Title = styled.div`
  font-size: 20px;
  flex: 1;
  width: 0;
`;

export const Icon = styled.img`
  width: 24px;
  height: 24px;
  scale: 0.8;
  border-radius: 4px;
`;

export const Operators = styled.div`
  display: flex;
  align-items: center;
  column-gap: 4px;
`;
