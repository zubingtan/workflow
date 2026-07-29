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
  Playground,
  WorkflowLineEntity,
  WorkflowNodeEntity,
  Emitter,
} from '@flowgram.ai/free-layout-editor';

import { WorkflowRuntimeClient, WorkflowRuntimeServerClient } from '../client';
import { GetGlobalVariableSchema } from '../../variable-panel-plugin';
import { WorkflowNodeType } from '../../../nodes';
import { cancelRun, getRunStatus, SERVER_URL } from '../../../api';

const SYNC_TASK_REPORT_INTERVAL = 500;
const SYNC_RUN_STATUS_INTERVAL = 500;

interface NodeRunningStatus {
  nodeID: string;
  status: WorkflowStatus;
  nodeResultLength: number;
}

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
  @inject(Playground) playground: Playground;

  @inject(WorkflowDocument) document: WorkflowDocument;

  @inject(WorkflowRuntimeClient) runtimeClient: WorkflowRuntimeClient;

  @inject(GetGlobalVariableSchema) getGlobalVariableSchema: GetGlobalVariableSchema;

  private runningNodes: WorkflowNodeEntity[] = [];

  private taskID?: string;

  private runID?: string;

  private syncTaskReportIntervalID?: ReturnType<typeof setInterval>;

  private syncRunStatusIntervalID?: ReturnType<typeof setInterval>;

  // #180: SSE subscription for saved-workflow runs. Replaces the
  // syncRunStatus + syncTaskReport polling loops. Undefined for draft runs
  // (which keep the polling path as tech-debt per #179).
  // Protected so LiveHistoryRuntimeService (#181) can reuse the same field
  // instead of redeclaring it (avoids TS2415 "separate declarations" error).
  protected eventSource?: EventSource;

  private reportEmitter = new Emitter<NodeReport>();

  private resetEmitter = new Emitter<{}>();

  private resultEmitter = new Emitter<{
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

  public async taskRun(inputs: WorkflowInputs): Promise<string | undefined> {
    if (this.taskID || this.runID) {
      await this.taskCancel();
    }
    const isFormValid = await this.validateForm();
    if (!isFormValid) {
      this.resultEmitter.fire({
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
        this.subscribeToRunEvents(runID, workflowId);
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
      await cancelRun(this.runID);
      return;
    }
    if (!this.taskID) {
      return;
    }
    await this.runtimeClient.TaskCancel({
      taskID: this.taskID,
    });
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
   *       Terminal — fire resultEmitter with result/errors, close EventSource.
   *
   * Decision (EventSource coordination, #180 §1): the Test Run panel opens
   * its OWN independent EventSource here — it does NOT reuse the
   * useActiveRunCounts / History Modal EventSource. Rationale: the editor
   * view (where Test Run lives) and the manager view (where History Modal
   * lives) are never mounted simultaneously (different SPA routes in
   * app.tsx). So the two EventSources can never coexist, and the §5
   * coordination (one EventSource per workflow) is preserved de facto.
   * Draft runs (no workflowId) keep the polling path as tech-debt (#179).
   */
  private subscribeToRunEvents(runID: string, workflowId: string): void {
    const url = `${SERVER_URL}/api/workflows/${workflowId}/runs/events`;
    const es = new EventSource(url);
    this.eventSource = es;

    es.onmessage = (ev) => {
      let payload: any;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!payload || typeof payload !== 'object') return;
      const { type, runID: evRunID, report, status: evStatus } = payload;
      // Only process events for the run we started (a workflow may have
      // multiple concurrent viewers each subscribed to the same stream).
      if (evRunID && evRunID !== runID) return;

      if (type === 'init' && Array.isArray(payload.activeRuns)) {
        // Late-subscriber catch-up: apply our run's cached intermediate report
        // (if any) so node status bars render immediately.
        for (const ar of payload.activeRuns) {
          if (ar?.runID === runID && ar.report) {
            this.updateReport(ar.report);
          }
        }
        return;
      }

      if (type === 'run_progress' && report) {
        this.updateReport(report);
        return;
      }

      if (type === 'run_status' && evStatus === 'terminated') {
        // cancelQueued: the run was cancelled while queued — no TaskReport.
        // Mirror syncRunStatus's terminated path. Clear runID so a subsequent
        // taskRun doesn't try to cancel an already-terminal run (the backend
        // would return 409 already_terminal).
        this.resultEmitter.fire({ errors: ['Run cancelled'] });
        es.close();
        this.eventSource = undefined;
        this.runID = undefined;
        return;
      }

      if (type === 'run_terminal') {
        // Terminal — fire resultEmitter with result or errors, mirroring
        // syncTaskReport's terminal classification. Clear runID/taskID so a
        // subsequent taskRun doesn't cancel an already-terminal run.
        const terminalReport = report;
        if (terminalReport) {
          const { outputs, inputs, messages } = terminalReport;
          if (outputs && Object.keys(outputs).length > 0) {
            this.resultEmitter.fire({ result: { inputs, outputs } });
          } else {
            this.resultEmitter.fire({
              errors: messages?.error?.map((message: any) =>
                message.nodeID ? `${message.nodeID}: ${message.message}` : message.message
              ),
            });
          }
        } else {
          this.resultEmitter.fire({ errors: ['Run ended with no report'] });
        }
        es.close();
        this.eventSource = undefined;
        this.runID = undefined;
        this.taskID = undefined;
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects on transient errors — leave it alone so
      // late events (e.g. run_terminal) still arrive after a blip.
      //
      // BUT: if the connection drops AFTER the run went terminal, the server
      // won't rebroadcast run_terminal to a reconnecting client (the init
      // frame only lists non-terminal active runs). The Test Run panel's own
      // queuePosition poll only updates queuePosition — it does NOT fire
      // onResultChanged. So a permanent drop after terminal would leave the
      // panel stuck on "Running...".
      //
      // Mitigation: on each error, poll GET /api/runs/:runID once. If it
      // shows terminal, fire resultEmitter + close the EventSource (mirrors
      // the run_terminal path). This is best-effort — if the network is fully
      // down the poll also fails, but EventSource keeps retrying and the next
      // successful reconnect's init frame will trigger a fresh status check.
      if (!runID) return;
      getRunStatus(runID)
        .then((res) => {
          if (
            res.status === 'succeeded' ||
            res.status === 'failed' ||
            res.status === 'terminated'
          ) {
            this.resultEmitter.fire(
              res.status === 'succeeded'
                ? { result: { inputs: {}, outputs: {} } }
                : { errors: [res.status === 'terminated' ? 'Run cancelled' : 'Run failed'] }
            );
            es.close();
            this.eventSource = undefined;
            this.runID = undefined;
            this.taskID = undefined;
          }
        })
        .catch(() => {
          // Network still down — EventSource will retry. Leave as-is.
        });
    };
  }

  private async validateForm(): Promise<boolean> {
    const allForms = this.document.getAllNodes().map((node) => node.form);
    const formValidations = await Promise.all(allForms.map(async (form) => form?.validate()));
    const validations = formValidations.filter((validation) => validation !== undefined);
    const isValid = validations.every((validation) => validation);
    return isValid;
  }

  private reset(): void {
    this.taskID = undefined;
    this.runID = undefined;
    this.nodeRunningStatus = new Map();
    this.runningNodes = [];
    if (this.syncTaskReportIntervalID) {
      clearInterval(this.syncTaskReportIntervalID);
    }
    if (this.syncRunStatusIntervalID) {
      clearInterval(this.syncRunStatusIntervalID);
    }
    // #180: close the SSE subscription if active.
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
    this.resetEmitter.fire({});
  }

  /**
   * Phase 3: poll GET /api/runs/:runID while queued. Once the run dequeues
   * (status='running' + task_id present), switch to TaskReport polling.
   */
  private async syncRunStatus(): Promise<void> {
    if (!this.runID) {
      return;
    }
    let status;
    try {
      const res = await getRunStatus(this.runID);
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
        if (status === 'terminated') {
          this.resultEmitter.fire({ errors: ['Run cancelled'] });
        } else if (status === 'failed') {
          this.resultEmitter.fire({ errors: ['Run failed'] });
        } else {
          this.resultEmitter.fire({ result: { inputs: {}, outputs: {} } });
        }
      }
    } catch {
      clearInterval(this.syncRunStatusIntervalID);
      this.syncRunStatusIntervalID = undefined;
      this.resultEmitter.fire({ errors: ['Failed to fetch run status'] });
    }
  }

  private async syncTaskReport(): Promise<void> {
    if (!this.taskID) {
      return;
    }
    const report = await this.runtimeClient.TaskReport({
      taskID: this.taskID,
    });
    if (!report) {
      clearInterval(this.syncTaskReportIntervalID);
      console.error('Sync task report failed');
      return;
    }
    const { workflowStatus, inputs, outputs, messages } = report;
    if (workflowStatus.terminated) {
      clearInterval(this.syncTaskReportIntervalID);
      if (Object.keys(outputs).length > 0) {
        this.resultEmitter.fire({ result: { inputs, outputs } });
      } else {
        this.resultEmitter.fire({
          errors: messages?.error?.map((message) =>
            message.nodeID ? `${message.nodeID}: ${message.message}` : message.message
          ),
        });
      }
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
            nodeID,
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
