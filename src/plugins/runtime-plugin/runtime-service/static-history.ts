/**
 * Phase 8 (#160): a read-only replacement for `WorkflowRuntimeService` used by
 * the HistoryViewer. It injects a pre-fetched terminal `IReport` into the
 * editor so `NodeStatusBar` (one per node) renders the historical per-node
 * state without any polling or live SSE.
 *
 * Subclasses `WorkflowRuntimeService` so the same DI token resolves and
 * TypeScript stays happy with `useService(WorkflowRuntimeService)`. The base
 * class's polling / `taskRun` machinery is never invoked — `taskRun`/`taskCancel`
 * are overridden as no-ops, and `flush()` (called from `onAllLayersRendered`)
 * fires the historical reports once.
 */
import { IReport } from '@flowgram.ai/runtime-interface';
import { WorkflowLineEntity, injectable } from '@flowgram.ai/free-layout-editor';

import { WorkflowRuntimeService } from './index';

@injectable()
export class StaticHistoryRuntimeService extends WorkflowRuntimeService {
  private historyReport: IReport | undefined;

  private historyRunID: string | undefined;

  private flushed = false;

  /**
   * Set the historical report + runID. Called by `createHistoryRuntimePlugin`'s
   * `onInit` (before subscribers attach). `flush()` is what actually fires the
   * emitters (after node renderers have mounted).
   */
  public setReport(report: IReport, runID?: string): void {
    this.historyReport = report;
    this.historyRunID = runID;
  }

  /**
   * Fire `onNodeReportChange` once per node in the report. Idempotent — safe
   * to call from `onAllLayersRendered` even if the editor re-renders. Must
   * run AFTER node renderers have subscribed (i.e. after mount).
   */
  public flush(): void {
    if (this.flushed || !this.historyReport) {
      return;
    }
    this.flushed = true;
    const { reports } = this.historyReport;
    for (const nodeID of Object.keys(reports)) {
      this.fireNodeReport(reports[nodeID]);
    }
  }

  // --- overrides: readonly, no live execution ---

  public override isFlowingLine(_line: WorkflowLineEntity): boolean {
    return false;
  }

  public override getCurrentRunID(): string | undefined {
    return this.historyRunID;
  }

  public override async taskRun(): Promise<undefined> {
    // Readonly — the Test Run panel isn't mounted in history view. No-op so
    // any stray caller can't launch a new run.
    return undefined;
  }

  public override async taskCancel(): Promise<void> {
    /* no-op */
  }
}
