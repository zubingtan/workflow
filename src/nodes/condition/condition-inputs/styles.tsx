/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { forwardRef, useLayoutEffect, useRef } from 'react';

import styled from 'styled-components';

/**
 * #190: ConditionPort is the DOM element scanned by `updateDynamicPorts()`
 * (`querySelectorAll('[data-port-id]')`). Its position determines where the
 * port anchor appears on the node (via `getBoundingClientRect().center`),
 * and its `data-port-location` attribute drives line routing.
 *
 * **Horizontal mode** (`$vertical` = false): CSS `right: -12px; top: 50%`
 * relative to the FormItem (which spans the node width). This works because
 * the FormItem's right edge coincides with the node's right edge.
 *
 * **Vertical mode** (`$vertical` = true): CSS `bottom: -12px; left: 50%`
 * would be relative to the FormItem, but the FormItem only spans one row -
 * NOT the node's bottom edge. So we use JS to compute an inline `top` that
 * places the port at the node's bottom edge. The JS runs in `useLayoutEffect`
 * (before `updateDynamicPorts()` which fires in `requestAnimationFrame`).
 */
export const ConditionPort = styled.div<{ $vertical?: boolean }>`
  position: absolute;
  ${({ $vertical }) => ($vertical ? 'bottom: -12px; left: 50%;' : 'right: -12px; top: 50%;')}
`;

/**
 * Wrapper that computes the correct inline position in vertical mode so the
 * port lands on the node's bottom edge (not the FormItem's bottom).
 * In horizontal mode, inline styles are cleared and CSS takes over.
 */
export const ConditionPortWithPosition = forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof ConditionPort>
>(function ConditionPortWithPosition(props, _ref) {
  const innerRef = useRef<HTMLDivElement>(null);
  const { $vertical } = props;

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    if (!$vertical) {
      // Clear inline styles so CSS (right/top) takes over.
      el.style.top = '';
      el.style.left = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = '';
      return;
    }
    // Vertical: position relative to the NODE, not the FormItem.
    const nodeEl = el.closest('.gedit-flow-activity-node') as HTMLElement | null;
    if (!nodeEl) return;
    const offsetParent = el.offsetParent as HTMLElement | null;
    if (!offsetParent) return;
    const nodeRect = nodeEl.getBoundingClientRect();
    const parentRect = offsetParent.getBoundingClientRect();
    // Place port 12px below the node's bottom edge, horizontally centered.
    const topOffset = nodeRect.bottom - parentRect.top + 12;
    const leftOffset = nodeRect.left + nodeRect.width / 2 - parentRect.left;
    el.style.top = `${topOffset}px`;
    el.style.left = `${leftOffset}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.style.transform = 'translateX(-50%)';
  });

  return <ConditionPort ref={innerRef} {...props} />;
});
