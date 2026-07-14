# M0 Acceptance Plan

## Decision Rule

`make verify-m0` is the single M0 acceptance command. Until PR7 implements the complete suite it must exit nonzero and print `REWORK`. After implementation, any failed blocking case also produces `REWORK`; only a complete pass produces `PASS`.

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
| M0-T08 | Worker crash | Lease handling ends in an explainable terminal state; no model call is auto-repeated. |
| M0-T09 | Full restart | Historical Run, node states, events, version reference, and output remain available. |
| M0-T10 | Browser E2E | Playwright completes import, run, status progression, output, history, failure, theme, and responsive flows against the real stack. |
| M0-T11 | Secret redaction | Logs, DOM, API responses, events, and database export contain no test secret. |
| M0-T12 | Support bundle | A redacted diagnostic bundle and both machine- and human-readable reports are generated. |

## Test Layers

- Vitest: schema, compiler, canonical hashing, state transitions, binding resolution, error classification, and redaction.
- PostgreSQL integration: immutable versions, transactional enqueue, atomic claim/lease, event ordering, crash sweep, and restart persistence.
- Compose system: app, worker, PostgreSQL, migration/seed, and Fake Provider with deterministic fault injection.
- Playwright: Chromium user flows against that complete stack, using accessible locators and explicit state waits. Failures retain screenshot, trace, video, console, and network summaries.

## Evidence and Release Gate

Each run records the Git SHA, environment and dependency versions, schema and migration versions, tests, events, logs, screenshots, traces, metrics, redaction scan, support bundle, `report.json`, and `report.md`. Release requires three consecutive clean-run passes on the same final `main` SHA. A failure invalidates the series; any fix goes through a new PR.
