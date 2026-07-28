import { useEffect, useRef, useState } from 'react';

import { SERVER_URL } from './api';

/**
 * Phase 6 (#158): per-workflow SSE subscription that tracks the number of
 * active (queued or running) runs. Drives the Delete button's disabled state
 * so the user can't attempt a delete that the backend will refuse with 409.
 *
 * Strategy (per the ticket): one EventSource per workflowId, opened on mount
 * and closed on unmount. Counts are reconciled from the Phase 5 event stream:
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
 * Reconnection: EventSource reconnects natively; on reconnect the bus flushes
 * a `:ping` frame. We don't need to re-fetch the initial counts because the
 * events we care about (active→terminal) are idempotent when applied to the
 * count — at worst the count is briefly stale until the next event.
 */
export function useActiveRunCounts(workflowIds: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Track per-runID so a run that goes queued→running→terminated is counted
  // once, not twice (increment on queued, then again on running).
  const knownRuns = useRef<Record<string, Set<string>>>({}); // workflowId → runIDs currently active

  useEffect(() => {
    const sources: Record<string, EventSource> = {};
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

    for (const id of workflowIds) {
      const url = `${SERVER_URL}/api/workflows/${id}/runs/events`;
      const es = new EventSource(url);
      sources[id] = es;

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

      es.onmessage = (ev) => {
        // Bus frames are `data: {...}\n\n`. EventSource delivers the payload
        // (without the `data:` prefix) via ev.data. Comments (`:ping`) are
        // not delivered as messages, so we only get real events here.
        let payload: any;
        try {
          payload = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!payload || typeof payload !== 'object') return;
        const { type, runID, status, workflowId } = payload;
        if (type === 'workflow_deleted' && workflowId === id) {
          // The workflow was deleted server-side. Drop our count; the list
          // will refresh and unmount this subscription.
          knownRuns.current[id]?.clear();
          setCounts((prev) => ({ ...prev, [id]: 0 }));
          es.close();
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
          // Terminal capture: regardless of status, the run left the active set.
          dropRun(runID);
        }
      };

      es.onerror = () => {
        // EventSource auto-reconnects; nothing to do here. If the workflow
        // was deleted, the next list refresh will unmount us.
      };
    }

    return () => {
      for (const id of Object.keys(sources)) {
        try {
          sources[id].close();
        } catch {
          /* ignore */
        }
      }
    };
    // We intentionally depend on the joined id list so a new workflow added
    // to the table picks up a subscription. Stringify keeps the dep stable
    // across renders that pass the same ids in a new array.
  }, [workflowIds.join('|')]);

  return counts;
}
