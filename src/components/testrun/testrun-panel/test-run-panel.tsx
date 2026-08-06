/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useState, useEffect } from 'react';

import classnames from 'classnames';
import { WorkflowInputs, WorkflowOutputs } from '@flowgram.ai/runtime-interface';
import { useService } from '@flowgram.ai/free-layout-editor';
import { Button, Switch } from '@douyinfe/semi-ui';
import { IconClose, IconPlay, IconSpin } from '@douyinfe/semi-icons';

import { TestRunJsonInput } from '../testrun-json-input';
import { TestRunForm } from '../testrun-form';
import { NodeStatusGroup } from '../node-status-bar/group';
import { useWorkflowId } from '../../workflow-context';
import { workflowRunEventHub } from '../../../workflow-run-event-hub.mjs';
import { WorkflowRuntimeService } from '../../../plugins/runtime-plugin/runtime-service';
import { useTestRunFormPanel } from '../../../plugins/panel-manager-plugin/hooks';
import { IconCancel } from '../../../assets/icon-cancel';
import { getRunStatus } from '../../../api';

import styles from './index.module.less';

export interface TestRunSidePanelProps {}

export const TestRunSidePanel: FC<TestRunSidePanelProps> = () => {
  const runtimeService = useService(WorkflowRuntimeService);
  const { close: closePanel } = useTestRunFormPanel();
  const workflowId = useWorkflowId();
  const [isRunning, setRunning] = useState(false);
  const [queuePosition, setQueuePosition] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<string[]>();
  const [result, setResult] = useState<
    | {
        inputs: WorkflowInputs;
        outputs: WorkflowOutputs;
      }
    | undefined
  >();
  const [workflowDeleted, setWorkflowDeleted] = useState(false);

  // en - Use localStorage to persist the JSON mode state
  const [inputJSONMode, _setInputJSONMode] = useState(() => {
    const savedMode = localStorage.getItem('testrun-input-json-mode');
    return savedMode ? JSON.parse(savedMode) : false;
  });

  const setInputJSONMode = (checked: boolean) => {
    _setInputJSONMode(checked);
    localStorage.setItem('testrun-input-json-mode', JSON.stringify(checked));
  };

  const onTestRun = async () => {
    if (workflowDeleted) return;
    if (isRunning) {
      await runtimeService.taskCancel();
      return;
    }
    setResult(undefined);
    setErrors(undefined);
    setQueuePosition(0);
    const id = await runtimeService.taskRun(values);
    if (id) {
      setRunning(true);
    }
  };

  const onClose = async () => {
    await runtimeService.taskCancel();
    setValues({});
    setRunning(false);
    closePanel();
  };

  const renderRunning = (
    <div className={styles['testrun-panel-running']}>
      <IconSpin spin size="large" />
      <div className={styles.text}>
        {queuePosition > 0 ? `Queued, position ${queuePosition}` : 'Running...'}
      </div>
    </div>
  );

  const renderForm = (
    <div className={styles['testrun-panel-form']}>
      <div className={styles['testrun-panel-input']}>
        <div className={styles.title}>Input Form</div>
        <div>JSON Mode</div>
        <Switch
          checked={inputJSONMode}
          onChange={(checked: boolean) => setInputJSONMode(checked)}
          size="small"
        />
      </div>
      {inputJSONMode ? (
        <TestRunJsonInput values={values} setValues={setValues} />
      ) : (
        <TestRunForm values={values} setValues={setValues} />
      )}
      {errors?.map((e) => (
        <div className={styles.error} key={e}>
          {e}
        </div>
      ))}
      <NodeStatusGroup title="Inputs Result" data={result?.inputs} optional disableCollapse />
      <NodeStatusGroup title="Outputs Result" data={result?.outputs} optional disableCollapse />
    </div>
  );

  const renderButton = (
    <Button
      onClick={onTestRun}
      disabled={workflowDeleted}
      icon={isRunning ? <IconCancel /> : <IconPlay size="small" />}
      className={classnames(styles.button, {
        [styles.running]: isRunning,
        [styles.default]: !isRunning,
      })}
    >
      {isRunning ? 'Cancel' : 'Test Run'}
    </Button>
  );

  useEffect(() => {
    const disposer = runtimeService.onResultChanged(({ result, errors }) => {
      setRunning(false);
      setQueuePosition(0);
      setResult(result);
      if (errors) {
        setErrors(errors);
      } else {
        setErrors(undefined);
      }
    });
    return () => disposer.dispose();
  }, []);

  useEffect(() => {
    setWorkflowDeleted(false);
    if (!workflowId) return undefined;
    return workflowRunEventHub.subscribe(workflowId, {
      types: ['workflow_deleted'],
      onEvent: (payload: any) => {
        if (payload?.type === 'workflow_deleted' && payload.workflowId === workflowId) {
          setWorkflowDeleted(true);
          setRunning(false);
        }
      },
    });
  }, [workflowId]);

  // Phase 3: while queued, poll GET /api/runs/:runID for queue position.
  // runtimeService exposes the current runID (if any) via a getter.
  useEffect(() => {
    if (!isRunning) {
      setQueuePosition(0);
      return;
    }
    const runID = runtimeService.getCurrentRunID?.();
    if (!runID) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await getRunStatus(runID);
        if (cancelled) return;
        if (res.status === 'queued') {
          setQueuePosition(res.queuePosition);
        } else {
          // Running or terminal — stop showing queue position.
          setQueuePosition(0);
        }
      } catch {
        // Ignore — the runtime-service also polls and will fire onResultChanged.
      }
    };
    poll();
    const interval = setInterval(poll, 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isRunning, runtimeService]);

  useEffect(
    () => () => {
      runtimeService.taskCancel();
    },
    [runtimeService]
  );

  return (
    <div className={styles['testrun-panel-container']}>
      <div className={styles['testrun-panel-header']}>
        <div className={styles['testrun-panel-title']}>Test Run</div>
        <Button
          className={styles['testrun-panel-title']}
          type="tertiary"
          icon={<IconClose />}
          size="small"
          theme="borderless"
          onClick={onClose}
        />
      </div>
      <div className={styles['testrun-panel-content']}>
        {workflowDeleted && (
          <div className={styles.error}>Workflow 已删除，运行摘要保留为只读。</div>
        )}
        {isRunning ? renderRunning : renderForm}
      </div>
      <div className={styles['testrun-panel-footer']}>{renderButton}</div>
    </div>
  );
};
