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
  gap: var(--app-space-1);
  background-color: var(--card);
  border-radius: 0 0 var(--app-radius-md) var(--app-radius-md);
  padding: 0 var(--app-space-3) var(--app-space-3);
`;

export const FormTitleDescription = styled.div`
  color: var(--muted-foreground);
  font-size: var(--app-font-size-xs);
  line-height: 20px;
  padding: 0 var(--app-space-1);
  word-break: break-all;
  white-space: break-spaces;
`;
