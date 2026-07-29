/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

export type LayoutDirection = 'LR' | 'TB';

/**
 * Layout direction indicator icon. Renders a different arrangement of
 * node boxes depending on the current direction so the active mode is
 * visible at a glance without hovering.
 *
 * - 'LR' (horizontal): three small boxes arranged left-to-right
 * - 'TB' (vertical): three small boxes arranged top-to-bottom
 */
export const IconLayoutDirection = ({ direction }: { direction: LayoutDirection }) => {
  if (direction === 'TB') {
    return (
      <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path
          fill="currentColor"
          d="M10 3H14C14.5523 3 15 3.44772 15 4V8C15 8.55228 14.5523 9 14 9H10C9.44772 9 9 8.55228 9 8V4C9 3.44772 9.44772 3 10 3ZM10 10H14C14.5523 10 15 10.4477 15 11V15C15 15.5523 14.5523 16 14 16H10C9.44772 16 9 15.5523 9 15V11C9 10.4477 9.44772 10 10 10ZM10 17H14C14.5523 17 15 17.4477 15 18V20C15 20.5523 14.5523 21 14 21H10C9.44772 21 9 20.5523 9 20V18C9 17.4477 9.44772 17 10 17Z"
        />
      </svg>
    );
  }
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        fill="currentColor"
        d="M3 10V14C3 14.5523 3.44772 15 4 15H8C8.55228 15 9 14.5523 9 14V10C9 9.44772 8.55228 9 8 9H4C3.44772 9 3 9.44772 3 10ZM10 10V14C10 14.5523 10.4477 15 11 15H15C15.5523 15 16 14.5523 16 14V10C16 9.44772 15.5523 9 15 9H11C10.4477 9 10 9.44772 10 10ZM17 10V14C17 14.5523 17.4477 15 18 15H20C20.5523 15 21 14.5523 21 14V10C21 9.44772 20.5523 9 20 9H18C17.4477 9 17 9.44772 17 10Z"
      />
    </svg>
  );
};
