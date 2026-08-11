/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';

// #190: share the single ConditionPort anchor (see
// `src/nodes/condition/condition-inputs/styles.tsx` for the rationale).
export { ConditionPort } from '../../condition/condition-inputs/styles';

export const ConditionBranch = styled.div`
  display: flex;
  width: 100%;
  align-items: stretch;
  position: relative;
`;

export const ConditionBranchLogic = styled.div`
  position: relative;
  width: 80px;
  display: flex;
  align-items: center;

  &::before {
    content: '';
    position: absolute;
    width: 50%;
    border: 1px solid var(--border);
    border-radius: var(--app-radius-md) 0 0 var(--app-radius-md);
    border-right: none;
    left: 50%;
    top: 32px;
    bottom: 32px;
  }
`;
