/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import styled from 'styled-components';

/**
 * #190: ConditionPort is the DOM element scanned by `updateDynamicPorts()`
 * (`querySelectorAll('[data-port-id]')`). Its CSS positioning edge determines
 * where the port anchor appears on the node, and its `data-port-location`
 * attribute (set by the renderer) drives line routing.
 *
 * In vertical mode (`$vertical` = true) the port sits on the bottom edge;
 * in horizontal mode it sits on the right edge (the original behavior).
 * `port.point` = `targetElement.getBoundingClientRect().center`, so moving
 * the DOM element via CSS is enough to move the anchor - no `port.update()`
 * call is needed (it would be overwritten by the next `updateDynamicPorts()`).
 */
export const ConditionPort = styled.div<{ $vertical?: boolean }>`
  position: absolute;
  ${({ $vertical }) => ($vertical ? 'bottom: -12px; left: 50%;' : 'right: -12px; top: 50%;')}
`;
