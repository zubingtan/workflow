/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC } from 'react';

interface IconGroupProps {
  size?: number;
}

export const IconGroup: FC<IconGroupProps> = ({ size }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      width: size,
      height: size,
    }}
  >
    <path
      id="group"
      fill="currentColor"
      fillRule="evenodd"
      stroke="none"
      d="M 0.009766 10 L 0.009766 9.990234 L 0 9.990234 L 0 7.5 L 1 7.5 L 1 9 L 2.5 9 L 2.5 10 L 0.009766 10 Z M 3.710938 10 L 3.710938 9 L 6.199219 9 L 6.199219 10 L 3.710938 10 Z M 7.5 10 L 7.5 9 L 9 9 L 9 7.5 L 10 7.5 L 10 9.990234 L 9.990234 9.990234 L 9.990234 10 L 7.5 10 Z M 0 6.289063 L 0 3.800781 L 1 3.800781 L 1 6.289063 L 0 6.289063 Z M 9 6.289063 L 9 3.800781 L 10 3.800781 L 10 6.289063 L 9 6.289063 Z M 0 2.5 L 0 0.009766 L 0.009766 0.009766 L 0.009766 0 L 2.5 0 L 2.5 1 L 1 1 L 1 2.5 L 0 2.5 Z M 9 2.5 L 9 1 L 7.5 1 L 7.5 0 L 9.990234 0 L 9.990234 0.009766 L 10 0.009766 L 10 2.5 L 9 2.5 Z M 3.710938 1 L 3.710938 0 L 6.199219 0 L 6.199219 1 L 3.710938 1 Z"
    />
  </svg>
);
