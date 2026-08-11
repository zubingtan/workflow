/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';

export const GroupTipsStyle = styled.div`
  position: absolute;
  top: 35px;

  width: 100%;
  height: 28px;
  white-space: nowrap;
  pointer-events: auto;

  .container {
    display: inline-flex;
    justify-content: center;
    height: 100%;
    width: 100%;
    background-color: var(--popover);
    border: 1px solid var(--border);
    border-radius: var(--app-radius-md) var(--app-radius-md) 0 0;

    .content {
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      justify-content: flex-start;

      width: fit-content;
      height: 100%;
      padding: 0 var(--app-space-3);

      .text {
        font-size: var(--app-font-size-md);
        font-weight: var(--app-font-weight-regular);
        font-style: normal;
        line-height: 20px;
        color: var(--popover-foreground);
        text-overflow: ellipsis;
        margin: 0;
      }

      .space {
        width: 128px;
      }
    }

    .actions {
      display: flex;
      gap: var(--app-space-2);
      align-items: center;

      height: 28px;
      padding: 0 var(--app-space-3);

      .close-forever {
        color: var(--muted-foreground);
      }

      .close {
        display: flex;
        height: 100%;
        align-items: center;

        svg {
          width: 16px;
          height: 16px;
        }
      }
    }
  }
`;
