/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';

/**
 * #190: ConditionPort is the invisible (0×0) anchor scanned by
 * `updateDynamicPorts()` (`querySelectorAll('[data-port-id]')`). Its
 * `getBoundingClientRect().center` determines where FlowGram renders the
 * visible port dot and where connection lines attach, and its
 * `data-port-location` attribute drives line routing.
 *
 * **Horizontal mode** (`$vertical` = false): rendered inside the branch's
 * FormItem row, CSS `right: -12px; top: 50%` places it on the node's right
 * edge at the row's vertical center.
 *
 * **Vertical mode** (`$vertical` = true): rendered via `createPortal` as a
 * direct child of the node element (`.gedit-flow-activity-node`, which is
 * `position: absolute`), so CSS `bottom: 0; left: <fraction>%` places it on
 * the node's bottom edge with pure CSS — no JS offset math, no rAF loop, no
 * zoom-scale correction. The horizontal fraction comes from an inline `left`
 * style set by the renderer (sorted by target x to avoid crossing lines).
 */
export const ConditionPort = styled.div<{ $vertical?: boolean }>`
  position: absolute;
  ${({ $vertical }) => ($vertical ? 'bottom: 0;' : 'right: -12px; top: 50%;')}
`;
