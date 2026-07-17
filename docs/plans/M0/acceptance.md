# M0 Acceptance Plan

> Historical M0 plan: `make verify-m0` is release-only. Pull requests run typecheck and the no-database, no-browser `test:fast` suite.

## Decision Rule

`make verify-m0` is the release-only M0 acceptance command. It runs every required layer exactly once when preparing release evidence. Pull requests run `pnpm typecheck` and `pnpm test:fast` only. Any failed blocking case or evidence-integrity check produces a nonzero exit and `REWORK`; only all thirteen blocking cases plus a valid sealed bundle produce `PASS` / `GO`.

## Blocking Coverage

| ID | Scenario | Required result |
|---|---|---|
| M0-T01 | Clean bootstrap | Isolated Compose stack starts and all readiness checks pass. |
| M0-T02 | Doctor | Missing configuration has an actionable diagnosis. |
| M0-T03 | Valid definition | Import creates an immutable definition version. |
| M0-T04 | Invalid definition | API and UI show node- and field-level validation errors without creating a version. |
| M0-T05 | Happy path | Input, Agent, and Output run in order and persisted Markdown is viewable. |
| M0-T06 | Provider auth failure | Agent fails, Output is skipped, and Run fails with `provider_auth_failed`. |
| M0-T07 | Provider timeout | Run reaches a terminal failure with `provider_timeout`. |
| M0-T07E | Provider empty output | Run reaches a terminal failure with `provider_empty_output`. |
| M0-T08 | Worker crash | Lease handling ends in `worker_lost` or `outcome_unknown`; no model call is auto-repeated. |
| M0-T09 | Full restart | Historical Run, node states, events, version reference, and output remain available. |
| M0-T10 | Browser E2E | Playwright completes import, run, progression, output, history, failure, theme, and responsive flows against the real stack. |
| M0-T11 | Secret redaction | Logs, DOM, API responses, events, database exports, and evidence contain no test secret. |
| M0-T12 | Support bundle | A redacted diagnostic bundle and both machine- and human-readable reports are generated. |

## Test Layers

- Vitest covers schema, compiler, canonical hashing, state transitions, binding resolution, error classification, and redaction.
- PostgreSQL integration covers immutable versions, transactional enqueue, atomic claim/lease, event ordering, crash sweep, and restart persistence.
- Compose system tests run the real app, worker, PostgreSQL, migration, and Fake Provider topology with deterministic fault injection.
- Playwright uses Chromium against that complete stack, accessible locators, and explicit state waits. Failure artifacts retain screenshot, trace, video, console, and network summaries where the secret-safety policy permits binary capture.

## Evidence and traceability

[`requirement-test-evidence.csv`](./requirement-test-evidence.csv) is the sealed-source 13-row `PENDING` template. It is never rewritten to imply a final result. Every acceptance invocation generates its own runtime `requirement-matrix.csv`, in which each Requirement points to one `test-results/M0-T*.json` result.

Each bundle records the exact Git SHA, runner and dependency versions, schema and migration versions, Pi version, captured container identities and image digests, layer results, events, logs, screenshots, traces, metrics, a redacted Support Bundle, `report.json`, and `report.md`. The bundle is closed by `MANIFEST` and verified by `SHA256SUMS`; missing, modified, duplicate, unexpected, or secret-containing evidence invalidates the result.

## Same-SHA three-run release gate

The final release gate is one manual `workflow_dispatch` of `.github/workflows/m0-release-gate.yml` with the exact final `main` Git SHA as input. The validate job proves that the input is current `main` and rejects a workflow rerun. The workflow then chains the reusable acceptance jobs sequentially:

```text
validate -> run1 -> run2 -> run3 -> aggregate
```

`run1`, `run2`, and `run3` each execute `make verify-m0` on an independent clean `ubuntu-24.04` runner with an isolated Compose project and database volume, all checked out at the same SHA. A failure stops the chain, marks the candidate `REWORK`, and prevents aggregation. Actions rerun cannot count as another consecutive pass; a defect requires a new PR, a new final `main` SHA, and a new single `workflow_dispatch` from `run1`.

Only after all three jobs pass does `aggregate` download the three immutable bundles, revalidate their identical Git SHA and secret safety, and create the aggregate `MANIFEST` and `SHA256SUMS`. The workflow verifies and aggregates evidence only; it does not create a tag or GitHub Release.

The final same-SHA three-run gate is currently `PENDING` until PR8 is merged and the release workflow is dispatched for the resulting final `main` commit.
