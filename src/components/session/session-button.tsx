/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect } from 'react';

import { Tooltip, IconButton, Badge } from '@douyinfe/semi-ui';
import { IconComment } from '@douyinfe/semi-icons';

import { sessionManager } from '../../services';
import { useSessionPanel } from '../../plugins/panel-manager-plugin/hooks';

export function SessionButton() {
  const { open: openPanel } = useSessionPanel();
  const [activeCount, setActiveCount] = useState(0);

  useEffect(
    () =>
      sessionManager.subscribe(() => {
        const count = sessionManager.getAll().filter((s) => s.status === 'streaming').length;
        setActiveCount(count);
      }),
    []
  );

  return (
    <Tooltip content="LLM Sessions">
      <Badge count={activeCount} position="rightTop" type="primary">
        <IconButton
          type="tertiary"
          theme="borderless"
          icon={<IconComment />}
          onClick={() => openPanel()}
        />
      </Badge>
    </Tooltip>
  );
}
