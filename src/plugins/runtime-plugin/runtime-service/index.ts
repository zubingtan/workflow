/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import {
  IReport,
  NodeReport,
  WorkflowInputs,
  WorkflowOutputs,
  WorkflowStatus,
} from '@flowgram.ai/runtime-interface';
import {
  injectable,
  inject,
  WorkflowDocument,
  WorkflowLineEntity,
  WorkflowNodeEntity,
  Emitter,
} from '@flowgram.ai/free-layout-editor';

import { WorkflowRuntimeClient, WorkflowRuntimeServerClient } from '../client';
import { GetGlobalVariableSchema } from '../../variable-panel-plugin';
import { isTerminalStatus, workflowRunEventHub } from '../../../workflow-run-event-hub.mjs';
import { WorkflowNodeType } from '../../../nodes';
import { cancelRun, getRun, getRunStatus } from '../../../api';
import type { RunStatus } from '../../../api';

const SYNC_TASK_REPORT_INTERVAL = 500;
const SYNC_RUN_STATUS_INTERVAL = 500;

interface NodeRunningStatus {
  status: WorkflowStatus;
  nodeResultLength: number;
}

type WorkflowRunTerminalStatus = Extract<RunStatus, 'succeeded' | 'failed' | 'terminated'>;

/**
 * Phase 3 (#155): the Test Run panel now supports queued status.
 *
 * When a saved-workflow run is submitted, POST /api/task/run returns
 * {runID, status:'queued'} (taskID is not yet available — the queue fills it
 * on dequeue). The runtime service stores runID, polls GET /api/runs/:runID
 * until status='running' + task_id is present, then switches to TaskReport
 * polling. Cancel uses PUT /api/runs/:runID/cancel (works for both queued
 * and running states).
 *
 * Draft runs (no workflowId) still return {taskID, status:'running'} and
 * use the taskID-based /api/task/* endpoints directly.
 */
@injectable()
export class WorkflowRuntimeService {
  @inject(WorkflowDocument) document: WorkflowDocument;

  @inject(WorkflowRuntimeClient) runtimeClient: WorkflowRuntimeClient;

  @inject(GetGlobalVariableSchema) getGlobalVariableSchema: GetGlobalVariableSchema;

  private runningNodes: WorkflowNodeEntity[] = [];

  private taskID?: string;

  private runID?: string;

  /** Monotonically separates retries so late terminal callbacks are ignored. */
  private executionRevision = 0;

  private syncTaskReportIntervalID?: ReturnType<typeof setInterval>;

  private syncRunStatusIntervalID?: ReturnType<typeof setInterval>;

  // #180: subscription for saved-workflow runs. The page-level
  // WorkflowRunEventHub owns the EventSource and ref-counts all consumers.
  // Protected so LiveHistoryRuntimeService (#181) can reuse the same field.
  protected eventSubscription?: () => void;

  private reportEmitter = new Emitter<NodeReport>();

  private resetEmitter = new Emitter<{}>();

  /** Terminal projection consumed by the Test Run panel. */
  private resultEmitter = new Emitter<{
    /** Canonical Workflow Run terminal state; errors are payload only. */
    status: WorkflowRunTerminalStatus;
    errors?: string[];
    result?: {
      inputs: WorkflowInputs;
      outputs: WorkflowOutputs;
    };
  }>();

  private nodeRunningStatus: Map<string, NodeRunningStatus>;

  public onNodeReportChange = this.reportEmitter.event;

  public onReset = this.resetEmitter.event;

  public onResultChanged = this.resultEmitter.event;

  /**
   * Phase 8 (#160): protected so `StaticHistoryRuntimeService` can fire the
   * historical per-node reports from its `flush()` method without exposing the
   * emitter publicly.
   */
  protected fireNodeReport(report: NodeReport): void {
    this.reportEmitter.fire(report);
  }

  public isFlowingLine(line: WorkflowLineEntity) {
    return this.runningNodes.some((node) => node.lines.inputLines.includes(line));
  }

  /**
   * Phase 3: expose the current runID (saved-workflow path) so the Test Run
   * panel can poll GET /api/runs/:runID for queue position. Returns undefined
   * for draft runs (which use taskID, not runID).
   */
  public getCurrentRunID(): string | undefined {
    return this.runID;
  }

  /** Return the handle for either a saved or draft execution. */
  public getCurrentExecutionID(): string | undefined {
    return this.runID ?? this.taskID;
  }

  public async taskRun(inputs: WorkflowInputs): Promise<string | undefined> {
    const previousRevision = this.executionRevision;
    this.executionRevision += 1;
    if (this.taskID || this.runID) {
      const previousRunID = this.runID;
      const previousTaskID = this.taskID;
      try {
        await this.taskCancel();
        // Cancellation has been requested successfully. Drop the old
        // handles before validation so an invalid retry cannot retain a dead
        // task/run whose callbacks belong to the previous revision.
        this.clearExecutionHandles();
      } catch (cancelError) {
        // A user can press Retry after the server has committed termination
        // but before the terminal SSE frame reaches this page. Treat that
        // already-terminal handle as stale; an active run must still surface
        // the original cancellation error.
        let terminal = false;
        if (previousRunID) {
          try {
            const status = await getRunStatus(previousRunID);
            terminal = isTerminalStatus(status.status);
          } catch {
            // Keep the original cancellation error when status recovery is
            // unavailable; the run may still be active.
          }
        } else if (previousTaskID) {
          try {
            const report = await this.runtimeClient.TaskReport({ taskID: previousTaskID });
            terminal = Boolean(report?.workflowStatus?.terminated);
          } catch {
            // Keep the original cancellation error when report recovery is
            // unavailable; the draft task may still be active.
          }
        }
        if (!terminal) {
          // Do not orphan an active execution: restore its callback revision
          // so the existing SSE/report owner can still settle it.
          this.executionRevision = previousRevision;
          throw cancelError;
        }
        this.clearExecutionHandles();
      }
    }
    const isFormValid = await this.validateForm();
    if (!isFormValid) {
      this.resultEmitter.fire({
        status: 'failed',
        errors: ['Form validation failed'],
      });
      return;
    }
    const schema = {
      ...this.document.toJSON(),
      globalVariable: this.getGlobalVariableSchema(),
    };

    const validateResult = await this.runtimeClient.TaskValidate({
      schema: JSON.stringify(schema),
      inputs,
    });
    if (!validateResult?.valid) {
      this.resultEmitter.fire({
        status: 'failed',
        errors: validateResult?.errors ?? ['Internal Server Error'],
      });
      return;
    }
    this.reset();
    let taskID: string | undefined;
    let runID: string | undefined;
    let status: string | undefined;
    try {
      const output = await this.runtimeClient.TaskRun({
        schema: JSON.stringify(schema),
        inputs,
      });
      taskID = output?.taskID;
      runID = (output as any)?.runID;
      status = (output as any)?.status;
    } catch (e) {
      this.resultEmitter.fire({
        status: 'failed',
        errors: [(e as Error)?.message],
      });
      return;
    }
    // Phase 3: saved-workflow runs return {runID, status:'queued'} (no taskID
    // yet — the queue fills it on dequeue). Draft runs return
    // {taskID, runID: taskID, status:'running'}.
    if (status === 'queued' && runID) {
      this.runID = runID;
      // #180: subscribe to SSE for saved-workflow runs. The SSE stream
      // delivers run_status (queued→running), run_progress (per-node), and
      // run_terminal (terminal) events, replacing the 500ms polling loops.
      // Draft runs (no workflowId) fall through to the taskID polling path.
      const workflowId = this.getWorkflowId();
      if (workflowId) {
        this.subscribeToRunEvents(runID, workflowId, this.executionRevision);
      } else {
        // Tech-debt: draft runs can't use SSE (no workflow to subscribe to).
        this.syncRunStatusIntervalID = setInterval(() => {
          this.syncRunStatus();
        }, SYNC_RUN_STATUS_INTERVAL);
      }
      return runID;
    }
    if (!taskID) {
      this.resultEmitter.fire({
        status: 'failed',
        errors: ['Task run failed'],
      });
      return;
    }
    this.taskID = taskID;
    this.syncTaskReportIntervalID = setInterval(() => {
      this.syncTaskReport();
    }, SYNC_TASK_REPORT_INTERVAL);
    return this.taskID;
  }

  public async taskCancel(): Promise<void> {
    if (this.runID) {
      // Saved-workflow run (queued or running) — use the unified cancel endpoint.
      const response = await cancelRun(this.runID);
      if (response.success === false && response.status !== 'terminated') {
        throw new Error(response.error ?? 'Run cancellation was not accepted');
      }
      return;
    }
    if (!this.taskID) {
      return;
    }
    const response = await this.runtimeClient.TaskCancel({
      taskID: this.taskID,
    });
    if (response?.success === false) {
      throw new Error('Task cancellation was not accepted');
    }
  }

  /**
   * #180: read the saved workflow's id from the server client. Returns
   * undefined for draft runs (no workflow to subscribe to) — those keep the
   * polling path as tech-debt per #179.
   */
  private getWorkflowId(): string | undefined {
    const client = this.runtimeClient as unknown as WorkflowRuntimeServerClient;
    if (typeof client.getWorkflowId === 'function') {
      return client.getWorkflowId();
    }
    return undefined;
  }

  /**
   * #180: subscribe to the per-workflow SSE event stream for a saved-workflow
   * run. Replaces the syncRunStatus (queued→running) + syncTaskReport
   * (running→terminal) polling loops. Events (from server/runs-events.mjs):
   *   - init {type:'init', activeRuns:[{runID, status, report}]}
   *       Late-subscriber catch-up — apply the cached intermediate report.
   *   - run_status {type:'run_status', runID, status, queued_at?|started_at?}
   *       'running' = dequeued (no action — SSE delivers progress automatically).
   *       'terminated' = cancelQueued (no TaskReport) — fire resultEmitter.
   *   - run_progress {type:'run_progress', runID, report: IReport}
   *       Per-node diff — call updateReport (handles runningNodes/isFlowingLine
   *       bookkeeping + reportEmitter firing).
   *   - run_terminal {type:'run_terminal', runID, status, report, ...}
   *       Terminal — fire resultEmitter with result/errors, remove subscription.
   *
   * The Test Run panel subscribes to the page-level hub. Draft runs (no
   * workflowId) keep the polling path as tech-debt (#179).
   */
  private subscribeToRunEvents(runID: string, workflowId: string, revision: number): void {
    let settled = false;
    let subscription: (() => void) | undefined;

    const removeSubscription = () => {
      const currentSubscription = subscription;
      if (!currentSubscription) return;
      subscription = undefined;
      currentSubscription();
      if (this.eventSubscription === currentSubscription) {
        this.eventSubscription = undefined;
      }
    };

    const finishRun = (notify: () => void) => {
      if (settled || this.runID !== runID || this.executionRevision !== revision) return;
      settled = true;
      notify();
      removeSubscription();
      this.clearExecutionHandles();
    };

    const emitReportResult = (report: any, status?: string) => {
      if (report?.reports) {
        this.updateReport(report);
      }
      this.emitTerminalReport(report, status);
    };

    const emitSnapshotResult = (status: string, report: any) => {
      if (report) {
        emitReportResult(report, status);
        return;
      }
      this.emitTerminalStatus(status);
    };

    // WorkflowRunEventHub owns EventSource reconnects and REST snapshot
    // reconciliation. This subscriber only consumes the resulting snapshot;
    // adding a second onError fetch here would race the hub's recovery path.
    subscription = workflowRunEventHub.subscribe(workflowId, {
      runID,
      onEvent: (payload: any) => {
        if (this.executionRevision !== revision) return;
        const { type, report, status: eventStatus } = payload;

        if (type === 'workflow_deleted') {
          finishRun(() =>
            this.resultEmitter.fire({ status: 'terminated', errors: ['Workflow deleted'] })
          );
          return;
        }

        if (type === 'init' && Array.isArray(payload.activeRuns)) {
          for (const activeRun of payload.activeRuns) {
            if (activeRun?.runID === runID && activeRun.report) {
              this.updateReport(activeRun.report);
            }
          }
          return;
        }

        if (type === 'snapshot' && Array.isArray(payload.runs)) {
          const snapshot = payload.runs.find((run: any) => run?.id === runID);
          if (snapshot && isTerminalStatus(snapshot.status)) {
            getRun(runID)
              .then((detail) => {
                if (settled || this.runID !== runID || this.executionRevision !== revision) return;
                finishRun(() => emitSnapshotResult(detail.status, detail.report));
              })
              .catch(() => {
                finishRun(() => emitSnapshotResult(snapshot.status, null));
              });
          }
          return;
        }

        if (type === 'run_progress' && report) {
          this.updateReport(report);
          return;
        }

        if (type === 'run_status' && eventStatus === 'terminated') {
          finishRun(() => this.emitTerminalStatus(eventStatus));
          return;
        }

        if (type === 'run_terminal') {
          const terminalReport = report;
          finishRun(() => {
            if (terminalReport) {
              emitReportResult(terminalReport, eventStatus);
            } else {
              this.emitTerminalStatus(eventStatus);
            }
          });
        }
      },
    });
    this.eventSubscription = subscription;
    if (settled) removeSubscription();
  }

  private async validateForm(): Promise<boolean> {
    const allForms = this.document.getAllNodes().map((node) => node.form);
    const formValidations = await Promise.all(allForms.map(async (form) => form?.validate()));
    const validations = formValidations.filter((validation) => validation !== undefined);
    const isValid = validations.every((validation) => validation);
    return isValid;
  }

  private reset(): void {
    this.clearExecutionHandles();
    this.nodeRunningStatus = new Map();
    this.runningNodes = [];
    this.resetEmitter.fire({});
  }

  /**
   * Drop all handles owned by an active execution without resetting the
   * editor's node state. Terminal reconciliation uses this path so a retry
   * cannot accidentally cancel the previous run/task after its terminal
   * report has already been observed.
   */
  private clearExecutionHandles(): void {
    this.taskID = undefined;
    this.runID = undefined;
    if (this.syncTaskReportIntervalID) {
      clearInterval(this.syncTaskReportIntervalID);
      this.syncTaskReportIntervalID = undefined;
    }
    if (this.syncRunStatusIntervalID) {
      clearInterval(this.syncRunStatusIntervalID);
      this.syncRunStatusIntervalID = undefined;
    }
    this.eventSubscription?.();
    this.eventSubscription = undefined;
  }

  /**
   * Reconcile a terminal execution discovered by REST polling (or by a
   * caller that missed the SSE terminal event). The handle must still be the
   * currently active runID/taskID; stale callbacks are ignored so a retry
   * cannot be clobbered by the previous run's final poll.
   */
  public async reconcileTerminal(
    handle: string,
    status?: string,
    report?: IReport | null
  ): Promise<void> {
    if (handle !== this.runID && handle !== this.taskID) {
      return;
    }
    const revision = this.executionRevision;

    let terminalStatus = status;
    let terminalReport = report;
    if (report === undefined) {
      try {
        const detail = await getRun(handle);
        if (
          revision !== this.executionRevision ||
          (handle !== this.runID && handle !== this.taskID)
        ) {
          return;
        }
        terminalStatus = detail.status ?? status;
        terminalReport = detail.report;
      } catch {
        // The terminal status is still authoritative even if the report
        // endpoint is temporarily unavailable.
        terminalReport = null;
      }
    }

    if (revision !== this.executionRevision || (handle !== this.runID && handle !== this.taskID)) {
      return;
    }
    if (terminalReport?.reports) {
      this.updateReport(terminalReport);
    }
    this.clearExecutionHandles();

    if (terminalReport) {
      this.emitTerminalReport(terminalReport, terminalStatus);
      return;
    }

    this.emitTerminalStatus(terminalStatus);
  }

  private emitTerminalStatus(status?: string): void {
    const normalizedStatus = status?.toLowerCase();
    if (normalizedStatus === 'succeeded') {
      this.resultEmitter.fire({ status: 'succeeded', result: { inputs: {}, outputs: {} } });
    } else if (
      normalizedStatus === 'terminated' ||
      normalizedStatus === 'cancelled' ||
      normalizedStatus === 'canceled'
    ) {
      this.resultEmitter.fire({ status: 'terminated', errors: ['Run terminated'] });
    } else {
      this.resultEmitter.fire({ status: 'failed', errors: ['Run failed'] });
    }
  }

  private emitTerminalReport(report: IReport, status?: string): void {
    const { outputs, inputs, messages } = report;
    const normalizedStatus = status?.toLowerCase();
    const reportStatus = report.workflowStatus?.status;
    const errors = Array.isArray(messages?.error)
      ? messages.error
          .map((message) =>
            message.nodeID ? `${message.nodeID}: ${message.message}` : message.message
          )
          .filter(Boolean)
      : [];
    const terminated =
      normalizedStatus === 'terminated' ||
      normalizedStatus === 'cancelled' ||
      normalizedStatus === 'canceled' ||
      reportStatus === WorkflowStatus.Cancelled;
    const failed = normalizedStatus === 'failed' || reportStatus === WorkflowStatus.Failed;

    // Terminal status/reason is authoritative. A cancelled or failed run can
    // still contain partial outputs in its report; those must not turn the
    // UI into a succeeded state. Preserve detailed node errors when present.
    if (terminated) {
      this.resultEmitter.fire({ status: 'terminated', errors: ['Run terminated'] });
      return;
    }
    if (failed) {
      this.resultEmitter.fire({
        status: 'failed',
        errors: errors.length > 0 ? errors : ['Run failed'],
      });
      return;
    }

    if (outputs && Object.keys(outputs).length > 0) {
      this.resultEmitter.fire({ status: 'succeeded', result: { inputs, outputs } });
      return;
    }

    if (errors && errors.length > 0) {
      this.resultEmitter.fire({ status: 'failed', errors });
      return;
    }

    // Successful workflows are allowed to have no output fields.
    this.resultEmitter.fire({
      status: 'succeeded',
      result: { inputs: inputs ?? {}, outputs: outputs ?? {} },
    });
  }

  /**
   * Phase 3: poll GET /api/runs/:runID while queued. Once the run dequeues
   * (status='running' + task_id present), switch to TaskReport polling.
   */
  private async syncRunStatus(): Promise<void> {
    const runID = this.runID;
    const revision = this.executionRevision;
    if (!runID) {
      return;
    }
    let status;
    try {
      const res = await getRunStatus(runID);
      if (this.runID !== runID || this.executionRevision !== revision) {
        return;
      }
      status = res.status;
      if (status === 'running' && res.task_id) {
        // Dequeued — switch to TaskReport polling.
        clearInterval(this.syncRunStatusIntervalID);
        this.syncRunStatusIntervalID = undefined;
        this.taskID = res.task_id;
        this.syncTaskReportIntervalID = setInterval(() => {
          this.syncTaskReport();
        }, SYNC_TASK_REPORT_INTERVAL);
        return;
      }
      if (status === 'terminated' || status === 'failed' || status === 'succeeded') {
        // Terminal before reaching running (e.g. cancelled while queued, or
        // wall-clock zombie — though the latter only affects running runs).
        clearInterval(this.syncRunStatusIntervalID);
        this.syncRunStatusIntervalID = undefined;
        // The reconciliation helper owns the full-row fetch so queue polling,
        // SSE recovery, and the panel's fallback share one terminal path.
        void this.reconcileTerminal(runID, status, res.report);
      }
    } catch {
      if (this.runID !== runID || this.executionRevision !== revision) {
        return;
      }
      clearInterval(this.syncRunStatusIntervalID);
      this.syncRunStatusIntervalID = undefined;
      this.resultEmitter.fire({ status: 'failed', errors: ['Failed to fetch run status'] });
    }
  }

  private async syncTaskReport(): Promise<void> {
    if (!this.taskID) {
      return;
    }
    const taskID = this.taskID;
    const revision = this.executionRevision;
    const report = await this.runtimeClient.TaskReport({ taskID });
    if (this.taskID !== taskID || this.executionRevision !== revision) {
      return;
    }
    if (!report) {
      void this.reconcileTerminal(taskID, 'failed');
      console.error('Sync task report failed');
      return;
    }
    const { workflowStatus } = report;
    if (workflowStatus.terminated) {
      void this.reconcileTerminal(taskID, workflowStatus.status, report);
      return;
    }
    this.updateReport(report);
  }

  private updateReport(report: IReport): void {
    const { reports } = report;
    this.runningNodes = [];
    this.document
      .getAllNodes()
      .filter(
        (node) =>
          ![WorkflowNodeType.BlockStart, WorkflowNodeType.BlockEnd].includes(
            node.flowNodeType as WorkflowNodeType
          )
      )
      .forEach((node) => {
        const nodeID = node.id;
        const nodeReport = reports[nodeID];
        if (!nodeReport) {
          return;
        }
        if (nodeReport.status === WorkflowStatus.Processing) {
          this.runningNodes.push(node);
        }
        const runningStatus = this.nodeRunningStatus.get(nodeID);
        if (
          !runningStatus ||
          nodeReport.status !== runningStatus.status ||
          nodeReport.snapshots.length !== runningStatus.nodeResultLength
        ) {
          this.nodeRunningStatus.set(nodeID, {
            status: nodeReport.status,
            nodeResultLength: nodeReport.snapshots.length,
          });
          this.reportEmitter.fire(nodeReport);
          this.document.linesManager.forceUpdate();
        } else if (nodeReport.status === WorkflowStatus.Processing) {
          this.reportEmitter.fire(nodeReport);
        }
      });
  }
}
