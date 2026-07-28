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

import { WorkflowRuntimeClient } from '../client';
import { GetGlobalVariableSchema } from '../../variable-panel-plugin';
import { WorkflowNodeType } from '../../../nodes';
import { cancelRun, getRunStatus } from '../../../api';

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
      this.syncRunStatusIntervalID = setInterval(() => {
        this.syncRunStatus();
      }, SYNC_RUN_STATUS_INTERVAL);
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
