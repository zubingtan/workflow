/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';

export const FormWrapper = styled.div`
  box-sizing: border-box;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background-color: var(--app-color-surface);
  border-radius: 0 0 var(--app-radius-md) var(--app-radius-md);
  padding: 0 var(--app-space-3) var(--app-space-3);
`;

export const FormTitleDescription = styled.div`
  color: var(--muted-foreground);
  font-size: 12px;
  line-height: 20px;
  padding: 0px 4px;
  word-break: break-all;
  white-space: break-spaces;
`;
