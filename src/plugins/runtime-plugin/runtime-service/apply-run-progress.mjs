/**
 * #181: pure helper that applies a run_progress IReport to the per-node status
 * cache, firing `fireNodeReport` only for nodes whose status or snapshot-length
 * changed. Mirrors `WorkflowRuntimeService.updateReport` (index.ts:285-322) but
 * extracted as a pure function so it's unit-testable without Playground/Document
 * DI and without TypeScript compilation.
 *
 * Kept framework-agnostic (no @flowgram.ai imports) so it can be imported from
 * a .mjs test directly. The .ts LiveHistoryRuntimeService wraps this.
 *
 * @param {import('@flowgram.ai/runtime-interface').IReport} report
 * @param {Map<string, {nodeID: string, status: string, nodeResultLength: number}>} prevNodeStatus
 *   Mutated in place.
 * @param {(nodeReport: import('@flowgram.ai/runtime-interface').NodeReport) => void} fireNodeReport
 */
export function applyRunProgress(report, prevNodeStatus, fireNodeReport) {
  const { reports } = report;
  for (const nodeID of Object.keys(reports)) {
    const nodeReport = reports[nodeID];
    if (!nodeReport) continue;
    const runningStatus = prevNodeStatus.get(nodeID);
    const snapshotLen = nodeReport.snapshots?.length ?? 0;
    if (
      !runningStatus ||
      nodeReport.status !== runningStatus.status ||
      snapshotLen !== runningStatus.nodeResultLength
    ) {
      prevNodeStatus.set(nodeID, {
        nodeID,
        status: nodeReport.status,
        nodeResultLength: snapshotLen,
      });
      fireNodeReport(nodeReport);
    }
  }
}
