/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useLayoutDirection } from '../../../hooks/use-layout-direction';

/**
 * #190: shared derivation used by condition and multi-condition renderers.
 * Returns the direction-aware flags that control port CSS edge and the
 * `data-port-location` attribute read by `updateDynamicPorts()`.
 */
export function useConditionPortLocation() {
  const { direction } = useLayoutDirection();
  const vertical = direction === 'TB';
  const portLocation = vertical ? 'bottom' : 'right';
  return { vertical, portLocation } as const;
}
