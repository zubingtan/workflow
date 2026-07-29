# ADR-0003: Per-Workflow serial queue (no global queue)

Date: 2026-07-29
Status: Accepted
Supersedes: —
Referenced by: Issue #138 (Workflow run management: history + serial queue), Issue #141 (terminal state merge)

## Context

When a user triggers multiple Runs of the same Workflow (e.g. clicking Test Run several times in quick succession, or multiple tabs submitting runs), those Runs compete for the same provider resources and the same Workflow's schema. Without serialization, concurrent Runs of the same Workflow can:

- Stomp each other's TaskReport if they share runtime state.
- Produce interleaved SSE events that confuse the History Modal.
- Race on Draft Lock / schema-hash mutex, requiring complex lock management.

Earlier drafts (#144) attempted a schema-hash 409 mutex for _saved_ Workflows — two Runs with the same schema hash would 409. This was removed because it blocked legitimate use cases (re-running the same Workflow after fixing a typo) and pushed complexity onto the caller.

## Decision

Use a **per-Workflow in-memory FIFO serial queue** (`Map<workflowId, {current, queue[]}>`). Runs of the same Workflow execute strictly in enqueue order; Runs of _different_ Workflows execute concurrently with no coordination.

Three and only three trigger points mutate the queue:

1. **enqueue** — if `current` is empty, dequeue immediately; otherwise push to `queue`.
2. **onTerminal** — clear `current`, dequeue next (if any).
3. **cancelQueued** — remove from `queue` without advancing (the cancelled Run never started, so no `onTerminal` fires).

A 30-minute wall-clock guard marks any `running` Run as `terminated` with `reason: wall_clock_zombie` — defensive against a lost `onTerminal` callback (e.g. process crash mid-run).

**No global queue.** Cross-Workflow prioritization is explicitly out of scope. Different Workflows have independent provider configs, independent schemas, and independent UI surfaces (History Modal is per-Workflow), so there is no resource contention to arbitrate.

**No bulk cancellation.** Each Active Run (queued or running) must be cancelled individually via `PUT /api/runs/:runID/cancel`. The cancel endpoint routes by DB row status: queued → `cancelQueued`, running → `cancelRunningRun` (which calls `TaskCancelAPI`), terminal → 409.

## Alternatives considered

- **Global queue with priority** — rejected. No evidence of cross-Workflow contention; adds priority/ starvation concerns; per-Workflow UI surfaces (History Modal) make per-Workflow queuing the natural unit.
- **Schema-hash 409 mutex for saved Workflows** (#144, removed) — rejected. Blocked legitimate re-runs; pushed retry logic to callers; Draft Lock covers the unsaved-draft case where the Queue doesn't apply.
- **Database-backed queue** — rejected for now. The in-memory queue survives for the process lifetime; `markInflightRunsInterrupted` on restart sweeps any orphaned `running` rows to `terminated`. A DB-backed queue would add durability but no current use case demands it (single-instance deployment, short Run lifetimes).

## Consequences

- Same-Workflow Runs are serialized; users see a "queued" status in the History Modal and can cancel queued Runs before they start.
- Different-Workflow Runs run concurrently — provider rate limits are the only cross-Workflow constraint.
- The 409 `workflow_busy` schema-hash mutex for saved Workflows is gone (Draft Lock remains for unsaved drafts only).
- `DELETE /workflows/:id` is guarded by `activeRunCount > 0` → 409 `workflow_has_active_runs` (no bulk cancel; user must cancel each Active Run first).
- Process restart sweeps in-flight `running` Runs to `terminated` with `reason: server_restart_interrupt` (the `markInflightRunsInterrupted` step in `db-schema.mjs`).
