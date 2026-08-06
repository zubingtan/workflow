/**
 * #181: read-only replacement for `WorkflowRuntimeService` used by the
 * ReadonlyViewer when rendering a live-running workflow. Subscribes to the
 * per-workflow event stream and fires `reportEmitter` on per-node change so
 * NodeStatusBar / AgentOutput render the live per-node state. The page-level
 * WorkflowRunEventHub owns the shared EventSource.
 *
 * Subclasses `WorkflowRuntimeService` so the same DI token resolves and
 * `useService(WorkflowRuntimeService)` picks it up. The base class's polling
 * machinery is never invoked — `taskRun`/`taskCancel` are overridden as
 * no-ops (readonly). The event subscription is owned by the service so it can
 * be torn down on dispose.
 */
import { NodeReport } from '@flowgram.ai/runtime-interface';
import { WorkflowLineEntity, injectable } from '@flowgram.ai/free-layout-editor';

import { isTerminalStatus, workflowRunEventHub } from '../../../workflow-run-event-hub.mjs';
import { WorkflowRuntimeService } from './index';
// Re-export the pure helper for TypeScript callers. The implementation lives
// in apply-run-progress.mjs so it's unit-testable from .mjs tests without TS
// compilation. Imported locally so the SSE handler can call it.
import { applyRunProgress, createReportBuffer } from './apply-run-progress.mjs';
export { applyRunProgress };

@injectable()
export class LiveHistoryRuntimeService extends WorkflowRuntimeService {
  private liveRunID?: string;

  private terminalNotified = false;

  private prevNodeStatus: Map<
    string,
    { nodeID: string; status: string; nodeResultLength: number }
  > = new Map();

  // #182: callback invoked when a run_terminal event for our runID arrives.
  // Set by the ReadonlyViewer so it can refetch + remount in static mode
  // WITHOUT opening a second SSE connection (HTTP/1.1 connection exhaustion
  // was observed in E2E: 6 useActiveRunCounts SSE + 1 modal SSE + 1 viewer
  // SSE + 1 live-history SSE = 9 > Chrome's 6-connection per-origin limit,
  // causing getRun fetch to hang indefinitely).
  private onTerminalCb?: () => void;

  private reportBuffer = createReportBuffer((report: NodeReport) => {
    this.fireNodeReport(report);
  });

  /**
   * Register a callback to be invoked when the SSE stream delivers a
   * `run_terminal` event for this run. The callback should trigger a refetch
   * of the run detail + Editor remount in static mode.
   */
  public setOnTerminal(cb: () => void): void {
    this.onTerminalCb = cb;
  }

  public flush(): void {
    this.reportBuffer.flush();
  }

  /**
   * Open the event subscription. Called by `createLiveHistoryRuntimePlugin`'s
   * `onInit` (after the editor mounts). The stream delivers:
   *   - `init {activeRuns: [{runID, status, report}]}` — late-subscriber catch-up
   *   - `run_progress {runID, report}` — per-node progress
   *   - `run_terminal {runID, status}` — terminal transition. We invoke the
   *     `onTerminal` callback (set by ReadonlyViewer) so the component can
   *     refetch + remount in static mode. This avoids a second SSE connection.
   */
  public subscribe(runID: string, workflowId: string): void {
    this.liveRunID = runID;
    this.terminalNotified = false;
    this.eventSubscription = workflowRunEventHub.subscribe(workflowId, {
      runID,
      onEvent: (payload: any) => {
        const { type, report, status } = payload;

        const notifyTerminal = () => {
          if (this.terminalNotified) return;
          this.terminalNotified = true;
          try {
            this.onTerminalCb?.();
          } catch {
            /* swallow — callback errors must not crash the event handler */
          }
        };

        if (type === 'init' && Array.isArray(payload.activeRuns)) {
          for (const activeRun of payload.activeRuns) {
            if (activeRun?.runID === this.liveRunID && activeRun.report) {
              applyRunProgress(activeRun.report, this.prevNodeStatus, (nr) =>
                this.reportBuffer.emit(nr)
              );
            }
          }
          return;
        }
        if (type === 'snapshot' && Array.isArray(payload.runs)) {
          const snapshot = payload.runs.find((run: any) => run?.id === this.liveRunID);
          if (snapshot && isTerminalStatus(snapshot.status)) notifyTerminal();
          return;
        }
        if (type === 'run_progress' && report) {
          applyRunProgress(report, this.prevNodeStatus, (nr) => this.reportBuffer.emit(nr));
        }
        if (type === 'run_status' && status === 'terminated') {
          notifyTerminal();
          return;
        }
        if (type === 'run_terminal') {
          // #182: invoke the component's terminal callback without opening a
          // second connection in the ReadonlyViewer.
          notifyTerminal();
        }
      },
    });
  }

  /**
   * Close the event subscription. Called when the ReadonlyViewer unmounts or
   * switches to static mode after terminal.
   */
  public dispose(): void {
    this.eventSubscription?.();
    this.eventSubscription = undefined;
    this.reportBuffer.clear();
  }

  // --- overrides: readonly, no live execution ---

  public override isFlowingLine(_line: WorkflowLineEntity): boolean {
    return false;
  }

  public override getCurrentRunID(): string | undefined {
    return this.liveRunID;
  }

  public override async taskRun(): Promise<undefined> {
    return undefined;
  }

  public override async taskCancel(): Promise<void> {
    /* no-op — cancellation goes through the ReadonlyViewer's Cancel button */
  }
}
