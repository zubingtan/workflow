/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useState } from 'react';

import { ChevronDown } from 'lucide-react';
import classNames from 'classnames';

import { DataStructureViewer } from '../viewer';

import styles from './index.module.less';

interface NodeStatusGroupProps {
  title: string;
  data: unknown;
  optional?: boolean;
  disableCollapse?: boolean;
  defaultExpanded?: boolean;
}

const isObjectHasContent = (obj: any = {}): boolean => obj && Object.keys(obj).length > 0;

export const NodeStatusGroup: FC<NodeStatusGroupProps> = ({
  title,
  data,
  optional = false,
  disableCollapse = false,
  defaultExpanded = true,
}) => {
  const hasContent = isObjectHasContent(data);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (optional && !hasContent) {
    return null;
  }

  return (
    <>
      <div
        className={styles['node-status-group']}
        onClick={() => hasContent && !disableCollapse && setIsExpanded(!isExpanded)}
      >
        {!disableCollapse && (
          <ChevronDown
            size={14}
            className={classNames(styles['node-status-group-icon'], {
              [styles['node-status-group-icon-expanded']]: isExpanded && hasContent,
            })}
          />
        )}
        <span>{title}:</span>
        {!hasContent && <span className={styles['node-status-group-tag']}>null</span>}
      </div>
      {hasContent && isExpanded ? <DataStructureViewer data={data} /> : null}
    </>
  );
};
