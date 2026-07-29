/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import React, { useState } from 'react';

import classNames from 'classnames';
import { IconChevronDown } from '@douyinfe/semi-icons';

import { useNodeRenderContext } from '../../../../hooks';

import styles from './index.module.less';

interface NodeStatusBarProps {
  header?: React.ReactNode;
  defaultShowDetail?: boolean;
  extraBtns?: React.ReactNode[];
}

export const NodeStatusHeader: React.FC<React.PropsWithChildren<NodeStatusBarProps>> = ({
  header,
  defaultShowDetail,
  children,
  extraBtns = [],
}) => {
  const [showDetail, setShowDetail] = useState(defaultShowDetail);
  const { selectNode } = useNodeRenderContext();

  const handleToggleShowDetail = (e: React.MouseEvent) => {
    e.stopPropagation();
    selectNode(e);
    setShowDetail(!showDetail);
  };

  return (
    <div
      className={styles['node-status-header']}
      // Must stop down propagation to prevent marquee selection and node hover (polygons not supported)
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className={classNames(
          styles['node-status-header-content'],
          showDetail && styles['node-status-header-content-opened']
        )}
        // Must stop down propagation to prevent marquee selection and node hover (polygons not supported)
        onMouseDown={(e) => e.stopPropagation()}
        // Other events go through click handling, and also need to stop propagation
        onClick={handleToggleShowDetail}
      >
        <div className={styles['status-title']}>
          {header}
          {extraBtns.length > 0 ? extraBtns : null}
        </div>
        <div className={styles['status-btns']}>
          <IconChevronDown
            className={classNames({
              [styles['is-show-detail']]: showDetail,
            })}
          />
        </div>
      </div>
      {showDetail ? children : null}
    </div>
  );
};
