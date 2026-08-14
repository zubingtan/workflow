/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useEffect, useRef, useState } from 'react';

import { LoaderCircle, Play, X } from 'lucide-react';
import classnames from 'classnames';
import { WorkflowInputs, WorkflowOutputs } from '@flowgram.ai/runtime-interface';
import { useService } from '@flowgram.ai/free-layout-editor';

import { Button, Checkbox } from '@/components/ui';

import { TestRunJsonInput } from '../testrun-json-input';
import { TestRunForm } from '../testrun-form';
import { NodeStatusGroup } from '../node-status-bar/group';
import { useWorkflowId } from '../../workflow-context';
import { workflowRunEventHub } from '../../../workflow-run-event-hub.mjs';
import { WorkflowRuntimeService } from '../../../plugins/runtime-plugin/runtime-service';
import { useTestRunFormPanel } from '../../../plugins/panel-manager-plugin/hooks';
import { IconCancel } from '../../../assets/icon-cancel';
import { getRunStatus } from '../../../api';
import {
  classifyTestRunResult,
  isTestRunActive,
  isTestRunTerminal,
  phaseFromRunStatus,
  testRunActionLabel,
  testRunStatusLabel,
} from './run-state.mjs';

import styles from './index.module.less';

export interface TestRunSidePanelProps {}

type TestRunPhase =
  | 'idle'
  | 'starting'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'terminated';

export const TestRunSidePanel: FC<TestRunSidePanelProps> = () => {
  const runtimeService = useService(WorkflowRuntimeService);
  const { close: closePanel } = useTestRunFormPanel();
  const workflowId = useWorkflowId();
  const [phase, setPhase] = useState<TestRunPhase>('idle');
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
  const workflowDeletedRef = useRef(false);
  // A terminal report can arrive while taskRun() is still awaiting the
  // server response (the fake provider intentionally makes this easy to
  // reproduce). The attempt marker prevents the post-await bookkeeping from
  // putting a completed run back into loading state.
  const attemptRef = useRef(0);
  const terminalAttemptRef = useRef(0);
  const cancelRequestedRef = useRef(false);
  const activeRef = useRef(false);

  const isRunning = isTestRunActive(phase);
  activeRef.current = isRunning;

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
      const attempt = attemptRef.current;
      cancelRequestedRef.current = true;
      try {
        await runtimeService.taskCancel();
        // The SSE/report event remains authoritative when it arrives, but do
        // not leave the panel in a spinner if the cancel response wins the
        // race with that event.
        if (attemptRef.current === attempt && terminalAttemptRef.current !== attempt) {
          terminalAttemptRef.current = attempt;
          setQueuePosition(0);
          setPhase('terminated');
          setErrors(['Run cancelled']);
        }
      } catch (error) {
        if (attemptRef.current === attempt) {
          setPhase('failed');
          setErrors([error instanceof Error ? error.message : 'Failed to cancel run']);
        }
      }
      return;
    }
    const attempt = ++attemptRef.current;
    terminalAttemptRef.current = 0;
    cancelRequestedRef.current = false;
    setResult(undefined);
    setErrors(undefined);
    setQueuePosition(0);
    setPhase('starting');
    try {
      const id = await runtimeService.taskRun(values);
      if (attemptRef.current !== attempt) return;
      if (cancelRequestedRef.current) {
        // Cancellation may be clicked during validation, before the runtime
        // has assigned a task/run id. Once taskRun resolves, make one best
        // effort cancel with the now-known id and keep the terminal UI state.
        terminalAttemptRef.current = attempt;
        try {
          await runtimeService.taskCancel();
        } catch {
          // A run that completed between validation and cancellation is
          // already reconciled by the result listener.
        }
        return;
      }
      if (terminalAttemptRef.current === attempt) return;
      if (!id) {
        setPhase('failed');
        setErrors((current) => current ?? ['Task run failed']);
        return;
      }
      // Saved workflows expose a run id immediately and begin in queued
      // state. Draft runs return a task id and are already running.
      setPhase(runtimeService.getCurrentRunID?.() ? 'queued' : 'running');
    } catch (error) {
      if (attemptRef.current !== attempt) return;
      setPhase('failed');
      setErrors([error instanceof Error ? error.message : 'Task run failed']);
    }
  };

  const onClose = async () => {
    const wasActive = activeRef.current;
    if (wasActive) {
      cancelRequestedRef.current = true;
      try {
        await runtimeService.taskCancel();
      } catch {
        // Closing is still allowed when the server has already transitioned
        // the run to a terminal state.
      }
    } else {
      attemptRef.current += 1;
    }
    setValues({});
    setPhase('idle');
    setQueuePosition(0);
    closePanel();
  };

  const renderRunning = (
    <div
      className={styles['testrun-panel-running']}
      data-testid="testrun-running"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle className="animate-spin" aria-hidden="true" />
      <div className={styles.text}>
        {phase === 'starting'
          ? 'Validating…'
          : queuePosition > 0
          ? `Queued, position ${queuePosition}`
          : 'Running…'}
      </div>
    </div>
  );

  const renderForm = (
    <div className={styles['testrun-panel-form']}>
      <div className={styles['testrun-panel-input']}>
        <div className={styles.title}>Input Form</div>
        <div>JSON Mode</div>
        <Checkbox
          aria-label="JSON Mode"
          checked={inputJSONMode}
          onCheckedChange={(checked) => setInputJSONMode(checked)}
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
      variant={isRunning ? 'destructive' : 'default'}
      size="sm"
      className={classnames(styles.button, isRunning && styles.running)}
      aria-label={isRunning ? 'Cancel' : testRunActionLabel(phase)}
    >
      {isRunning ? <IconCancel /> : <Play data-icon="inline-start" aria-hidden="true" />}
      {isRunning ? 'Cancel' : testRunActionLabel(phase)}
    </Button>
  );

  useEffect(() => {
    const disposer = runtimeService.onResultChanged(({ result, errors }) => {
      if (workflowDeletedRef.current || attemptRef.current === 0) return;
      const classified = classifyTestRunResult({ result, errors });
      terminalAttemptRef.current = attemptRef.current;
      setPhase(classified.phase);
      setQueuePosition(0);
      setResult(result);
      if (classified.errors.length > 0) {
        setErrors(classified.errors);
      } else {
        setErrors(undefined);
      }
    });
    return () => disposer.dispose();
  }, [runtimeService]);

  useEffect(() => {
    // A provider can reuse this panel while the editor switches workflows.
    // Do not let the previous workflow's result stream populate the new one.
    attemptRef.current = 0;
    terminalAttemptRef.current = 0;
    cancelRequestedRef.current = false;
    workflowDeletedRef.current = false;
    setWorkflowDeleted(false);
    setPhase('idle');
    setResult(undefined);
    setErrors(undefined);
    setQueuePosition(0);
    if (!workflowId) return undefined;
    const disposer = workflowRunEventHub.subscribe(workflowId, {
      types: ['workflow_deleted'],
      onEvent: (payload: any) => {
        if (payload?.type === 'workflow_deleted' && payload.workflowId === workflowId) {
          workflowDeletedRef.current = true;
          setWorkflowDeleted(true);
          attemptRef.current += 1;
          setPhase('terminated');
          setQueuePosition(0);
          setErrors(['Workflow deleted']);
        }
      },
    });
    return () => {
      attemptRef.current = 0;
      cancelRequestedRef.current = true;
      const wasActive = activeRef.current;
      activeRef.current = false;
      if (wasActive) void runtimeService.taskCancel().catch(() => undefined);
      disposer();
    };
  }, [runtimeService, workflowId]);

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
      const attempt = attemptRef.current;
      try {
        const res = await getRunStatus(runID);
        if (cancelled || attemptRef.current !== attempt) return;
        if (res.status === 'queued') {
          setQueuePosition(res.queuePosition ?? 0);
          setPhase(phaseFromRunStatus(res.status, res.queuePosition));
        } else if (res.status === 'running') {
          setQueuePosition(0);
          setPhase(phaseFromRunStatus(res.status));
        } else if (isTestRunTerminal(phaseFromRunStatus(res.status))) {
          terminalAttemptRef.current = attemptRef.current;
          setQueuePosition(0);
          const nextPhase = phaseFromRunStatus(res.status);
          setPhase(nextPhase);
          if (nextPhase === 'terminated') {
            setErrors((current) => current ?? ['Run terminated']);
          } else if (nextPhase === 'failed') {
            setErrors((current) => current ?? ['Run failed']);
          }

          // The status endpoint is also the recovery path when the SSE
          // terminal event was missed. The runtime service owns the full-row
          // fetch and clears its handle only when this attempt is still live.
          if (!cancelled && attemptRef.current === attempt) {
            void runtimeService.reconcileTerminal(runID, res.status);
          }
        } else {
          // Unknown status — stop showing queue position and let the runtime
          // service reconcile the terminal report if one is available.
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
      if (activeRef.current) void runtimeService.taskCancel().catch(() => undefined);
    },
    [runtimeService]
  );

  return (
    <div className={styles['testrun-panel-container']}>
      <div className={styles['testrun-panel-header']}>
        <div className={styles['testrun-panel-title']}>Test Run</div>
        <Button
          className={styles['testrun-panel-close']}
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          title="Close Test Run"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className={styles['testrun-panel-content']}>
        {workflowDeleted && (
          <div className={styles.error}>Workflow deleted; the run summary is read-only.</div>
        )}
        {phase !== 'idle' && !isRunning && (
          <div
            className={classnames(styles.status, styles[`status-${phase}`])}
            data-testid="testrun-status"
            data-run-phase={phase}
            role="status"
            aria-live="polite"
          >
            {testRunStatusLabel(phase)}
          </div>
        )}
        {isRunning ? renderRunning : renderForm}
      </div>
      <div className={styles['testrun-panel-footer']}>{renderButton}</div>
    </div>
  );
};
