/**
 * #181: read-only replacement for `WorkflowRuntimeService` used by the
 * ReadonlyViewer when rendering a live-running workflow. Subscribes to the
 * per-workflow SSE event stream and fires `reportEmitter` on per-node change
 * so NodeStatusBar / AgentOutput render the live per-node state.
 *
 * Subclasses `WorkflowRuntimeService` so the same DI token resolves and
 * `useService(WorkflowRuntimeService)` picks it up. The base class's polling
 * machinery is never invoked — `taskRun`/`taskCancel` are overridden as
 * no-ops (readonly). The SSE subscription is owned by the service so it can
 * be torn down on dispose.
 */
import { WorkflowLineEntity, injectable } from '@flowgram.ai/free-layout-editor';

import { SERVER_URL } from '../../../api';
import { WorkflowRuntimeService } from './index';
// Re-export the pure helper for TypeScript callers. The implementation lives
// in apply-run-progress.mjs so it's unit-testable from .mjs tests without TS
// compilation. Imported locally so the SSE handler can call it.
import { applyRunProgress } from './apply-run-progress.mjs';
export { applyRunProgress };

@injectable()
export class LiveHistoryRuntimeService extends WorkflowRuntimeService {
  private liveRunID?: string;

  private eventSource?: EventSource;

  private prevNodeStatus: Map<
    string,
    { nodeID: string; status: string; nodeResultLength: number }
  > = new Map();

  /**
   * Open the SSE subscription. Called by `createLiveHistoryRuntimePlugin`'s
   * `onInit` (after the editor mounts). The stream delivers:
   *   - `init {activeRuns: [{runID, status, report}]}` — late-subscriber catch-up
   *   - `run_progress {runID, report}` — per-node progress
   *   - `run_terminal {runID, status}` — terminal transition (handled by the
   *     ReadonlyViewer component, which refetches and remounts in static mode)
   */
  public subscribe(runID: string, workflowId: string): void {
    this.liveRunID = runID;
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
      const { type, runID: evRunID, report } = payload;
      // Only process events for the run we're viewing.
      if (evRunID && evRunID !== this.liveRunID) return;
      if (type === 'init' && Array.isArray(payload.activeRuns)) {
        // Late-subscriber catch-up: find our run's cached report.
        for (const ar of payload.activeRuns) {
          if (ar?.runID === this.liveRunID && ar.report) {
            applyRunProgress(ar.report, this.prevNodeStatus, (nr) => this.fireNodeReport(nr));
          }
        }
        return;
      }
      if (type === 'run_progress' && report) {
        applyRunProgress(report, this.prevNodeStatus, (nr) => this.fireNodeReport(nr));
      }
      // run_terminal is handled by the ReadonlyViewer component (it refetches
      // and remounts). We don't fire anything here — the terminal report
      // arrives via the remount's StaticHistoryRuntimeService.
    };
  }

  /**
   * Close the SSE subscription. Called when the ReadonlyViewer unmounts or
   * switches to static mode after terminal.
   */
  public dispose(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = undefined;
    }
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
