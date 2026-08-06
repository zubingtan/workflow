import { useEffect, useRef, useState } from 'react';

import { workflowRunEventHub } from './workflow-run-event-hub.mjs';

/**
 * Phase 6 (#158): per-workflow SSE subscription that tracks the number of
 * active (queued or running) runs. Drives the Delete button's disabled state
 * so the user can't attempt a delete that the backend will refuse with 409.
 *
 * Strategy (per the ticket): one shared page-level connection for all workflow
 * IDs, opened while at least one consumer is mounted. Counts are reconciled from
 * the Phase 5 event stream:
 *   - run_status {status:'queued'|'running'}  → increment
 *   - run_status {status:'terminated'}          → decrement
 *   - run_terminal (any status)                 → decrement (the run left
 *                                                  the active set)
 *   - workflow_deleted {workflowId}             → drop that workflowId's
 *                                                  subscription (its row will
 *                                                  be removed from the list)
 *
 * The first `run_status` for a run we haven't seen counts as a new active run;
 * a `run_terminal` for an unknown run is a no-op (defensive). This is good
 * enough for the Delete-button gate — the backend 409 is the source of truth.
 *
 * Reconnection and snapshot reconciliation are owned by WorkflowRunEventHub.
 */
export function useActiveRunCounts(workflowIds: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Track per-runID so a run that goes queued→running→terminated is counted
  // once, not twice (increment on queued, then again on running).
  const knownRuns = useRef<Record<string, Set<string>>>({}); // workflowId → runIDs currently active

  useEffect(() => {
    const activeIds = new Set(workflowIds);

    // Drop counts/runs for workflows no longer in the list (e.g. deleted).
    setCounts((prev) => {
      const next: Record<string, number> = {};
      for (const id of activeIds) next[id] = prev[id] ?? 0;
      return next;
    });
    knownRuns.current = Object.fromEntries(
      workflowIds.map((id) => [id, knownRuns.current[id] ?? new Set<string>()])
    );

    const subscriptions = workflowIds.map((id) => {
      const bump = (delta: number) => {
        setCounts((prev) => ({ ...prev, [id]: Math.max(0, (prev[id] ?? 0) + delta) }));
      };
      const addRun = (runID: string) => {
        const set = knownRuns.current[id];
        if (!set) return;
        if (set.has(runID)) return;
        set.add(runID);
        bump(1);
      };
      const dropRun = (runID: string) => {
        const set = knownRuns.current[id];
        if (!set) return;
        if (!set.has(runID)) return;
        set.delete(runID);
        bump(-1);
      };

      return {
        workflowId: id,
        subscription: {
          onEvent: (payload: any) => {
            if (!payload || typeof payload !== 'object') return;
            const { type, runID, status, workflowId } = payload;
            if (type === 'workflow_deleted' && workflowId === id) {
              knownRuns.current[id]?.clear();
              setCounts((prev) => ({ ...prev, [id]: 0 }));
              return;
            }
            if (type === 'snapshot' && Array.isArray(payload.runs)) {
              const set = new Set<string>();
              for (const run of payload.runs) {
                if (
                  typeof run?.id === 'string' &&
                  (run.status === 'queued' || run.status === 'running')
                ) {
                  set.add(run.id);
                }
              }
              knownRuns.current[id] = set;
              setCounts((prev) => ({ ...prev, [id]: set.size }));
              return;
            }
            if (type === 'init' && Array.isArray(payload.activeRunIDs)) {
              const set = knownRuns.current[id] ?? new Set<string>();
              set.clear();
              for (const rid of payload.activeRunIDs) {
                if (typeof rid === 'string') set.add(rid);
              }
              knownRuns.current[id] = set;
              setCounts((prev) => ({ ...prev, [id]: set.size }));
              return;
            }
            if (!runID) return;
            if (type === 'run_status') {
              if (status === 'queued' || status === 'running') {
                addRun(runID);
              } else if (status === 'terminated') {
                dropRun(runID);
              }
            } else if (type === 'run_terminal') {
              dropRun(runID);
            }
          },
        },
      };
    });
    const unsubscribe = workflowRunEventHub.subscribeMany(subscriptions);

    return unsubscribe;
    // We intentionally depend on the joined id list so a new workflow added
    // to the table picks up a subscription. Stringify keeps the dep stable
    // across renders that pass the same ids in a new array.
  }, [workflowIds.join('|')]);

  return counts;
}
