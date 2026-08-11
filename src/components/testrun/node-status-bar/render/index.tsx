/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useMemo, useState } from 'react';

import { LoaderCircle } from 'lucide-react';
import classnames from 'classnames';
import { NodeReport, WorkflowStatus } from '@flowgram.ai/runtime-interface';

import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';

import { NodeStatusHeader } from '../header';
import { NodeStatusGroup } from '../group';
import { IconWarningFill } from '../../../../assets/icon-warning';
import { IconSuccessFill } from '../../../../assets/icon-success';

import styles from './index.module.less';

interface NodeStatusRenderProps {
  report: NodeReport;
}

const msToSeconds = (ms: number): string => (ms / 1000).toFixed(2) + 's';
const displayCount = 6;

const splitExecutionDetails = (outputs: unknown) => {
  if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
    return { declaredOutputs: outputs, executionDetails: undefined };
  }

  const { _executionDetail: executionDetails, ...declaredOutputs } = outputs as Record<
    string,
    unknown
  >;
  return { declaredOutputs, executionDetails };
};

export const NodeStatusRender: FC<NodeStatusRenderProps> = ({ report }) => {
  const { status: nodeStatus } = report;
  const [currentSnapshotIndex, setCurrentSnapshotIndex] = useState(0);

  const snapshots = report.snapshots || [];
  const currentSnapshot = snapshots[currentSnapshotIndex] || snapshots[0];
  const { declaredOutputs, executionDetails } = splitExecutionDetails(currentSnapshot?.outputs);

  // Node has 5 states
  const isNodePending = nodeStatus === WorkflowStatus.Pending;
  const isNodeProcessing = nodeStatus === WorkflowStatus.Processing;
  const isNodeFailed = nodeStatus === WorkflowStatus.Failed;
  const isNodeSucceed = nodeStatus === WorkflowStatus.Succeeded;
  const isNodeCancelled = nodeStatus === WorkflowStatus.Cancelled;

  const tagColor = useMemo(() => {
    if (isNodeSucceed) {
      return styles.nodeStatusSucceed;
    }
    if (isNodeFailed) {
      return styles.nodeStatusFailed;
    }
    if (isNodeProcessing) {
      return styles.nodeStatusProcessing;
    }
  }, [isNodeSucceed, isNodeFailed, isNodeProcessing]);

  const renderIcon = () => {
    if (isNodeProcessing) {
      return (
        <LoaderCircle className={classnames(styles.icon, styles.processing, 'animate-spin')} />
      );
    }
    if (isNodeSucceed) {
      return <IconSuccessFill />;
    }
    return <IconWarningFill className={classnames(tagColor, styles.round)} />;
  };
  const renderDesc = () => {
    const getDesc = () => {
      if (isNodeProcessing) {
        return 'Running';
      } else if (isNodePending) {
        return 'Run terminated';
      } else if (isNodeSucceed) {
        return 'Succeed';
      } else if (isNodeFailed) {
        return 'Failed';
      } else if (isNodeCancelled) {
        return 'Cancelled';
      }
    };

    const desc = getDesc();

    return desc ? <p className={styles.desc}>{desc}</p> : null;
  };
  const renderCost = () => <span className={tagColor}>{msToSeconds(report.timeCost)}</span>;

  const renderSnapshotNavigation = () => {
    if (snapshots.length <= 1) {
      return null;
    }

    const count = <p className={styles.count}>Total: {snapshots.length}</p>;

    if (snapshots.length <= displayCount) {
      return (
        <>
          {count}
          <div className={styles.snapshotNavigation}>
            {snapshots.map((_, index) => (
              <Button
                key={index}
                size="sm"
                variant={currentSnapshotIndex === index ? 'default' : 'outline'}
                onClick={() => setCurrentSnapshotIndex(index)}
                className={classnames(styles.snapshotButton, {
                  [styles.active]: currentSnapshotIndex === index,
                  [styles.inactive]: currentSnapshotIndex !== index,
                })}
              >
                {index + 1}
              </Button>
            ))}
          </div>
        </>
      );
    }

    // When more than 5, the first 5 render as buttons; the rest go in a dropdown
    return (
      <>
        {count}
        <div className={styles.snapshotNavigation}>
          {snapshots.slice(0, displayCount).map((_, index) => (
            <Button
              key={index}
              size="sm"
              variant="outline"
              onClick={() => setCurrentSnapshotIndex(index)}
              className={classnames(styles.snapshotButton, {
                [styles.active]: currentSnapshotIndex === index,
                [styles.inactive]: currentSnapshotIndex !== index,
              })}
            >
              {index + 1}
            </Button>
          ))}
          <Select
            aria-label="Select snapshot"
            value={currentSnapshotIndex >= displayCount ? String(currentSnapshotIndex) : ''}
            onChange={(event) => setCurrentSnapshotIndex(Number(event.target.value))}
            className={classnames(styles.snapshotSelect, {
              [styles.active]: currentSnapshotIndex >= displayCount,
              [styles.inactive]: currentSnapshotIndex < displayCount,
            })}
          >
            <option value="" disabled>
              Select
            </option>
            {snapshots.slice(displayCount).map((_, index) => {
              const actualIndex = index + displayCount;
              return (
                <option key={actualIndex} value={actualIndex}>
                  {actualIndex + 1}
                </option>
              );
            })}
          </Select>
        </div>
      </>
    );
  };

  if (!report) {
    return null;
  }

  return (
    <NodeStatusHeader
      header={
        <>
          {renderIcon()}
          {renderDesc()}
          {renderCost()}
        </>
      }
    >
      <div className={styles.container}>
        {isNodeFailed && currentSnapshot?.error && (
          <div className={styles.error}>{currentSnapshot.error}</div>
        )}
        {renderSnapshotNavigation()}
        <NodeStatusGroup title="Inputs" data={currentSnapshot?.inputs} />
        <NodeStatusGroup title="Outputs" data={declaredOutputs} />
        <NodeStatusGroup
          title="Execution Details"
          data={executionDetails}
          optional
          defaultExpanded={false}
        />
        <NodeStatusGroup title="Branch" data={currentSnapshot?.branch} optional />
        <NodeStatusGroup title="Data" data={currentSnapshot?.data} optional />
      </div>
    </NodeStatusHeader>
  );
};
