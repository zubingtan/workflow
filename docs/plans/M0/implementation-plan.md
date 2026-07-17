# M0 Implementation Plan

> Historical M0 plan: the current delivery policy keeps `make verify-m0` release-only; PRs use typecheck plus `test:fast`.

## Objective

Deliver the v0.4 M0 local executable workflow skeleton: a clean machine can start the stack, import and validate an immutable JSON definition, run `input.prompt -> process.agent -> output.markdown` asynchronously, inspect failures and persisted history in a temporary Web UI, and produce automated acceptance evidence.

## Authority and Conflict Resolution

Use this precedence when artifacts disagree:

1. Current explicit user decisions.
2. Roadmap milestone scope and exit criteria.
3. Milestone Automated Acceptance blocking gates.
4. Accepted ADRs.
5. Design Doc execution and module semantics.
6. PRD and Workflow Testing UX.
7. Documentation Governance.
8. Memory Design, Feasibility, README, Changelog, and validation reports.

The thirteen files under `docs/source/v0.4` are an immutable source snapshot. Project plans record implementation-specific decisions without rewriting that snapshot.

## M0 Contracts

- The only workflow shape is `input.prompt -> process.agent -> output.markdown`; JSON is the definition source of truth and the Board is read-only.
- Workflow and Agent definition versions are immutable. Each Run references the exact versions used.
- A `process.agent` node references `agentVersionRef` and a node-level `providerBindingRef`. Provider credentials, base URLs, and runtime model overrides never enter the Definition.
- The API validates and transactionally creates the Run and PostgreSQL queue job, returning `202`; an independent worker performs Pi Runtime calls and persists state and events.
- Worker loss must resolve to an explicit terminal failure when the model outcome is not safely known. M0 never automatically repeats the model call.
- Markdown output remains in PostgreSQL. The local artifact sink is limited to acceptance evidence and support bundles.
- M0 UI scope is Workflow List, JSON Import, read-only Board, Run Form, History, and Run Detail. Prompt input remains a temporary right-side sheet and does not define the future Builder.
- Formal browser coverage uses Playwright against the real Next.js app, worker, PostgreSQL, and Fake Provider; API mocks are not the M0 E2E acceptance path.

## Sequential Delivery

1. **PR1 — governance-agent-policy-ci:** source snapshot, governance rules, bounded custom agents, policy tests, M0 plan skeletons, and the explicit `verify-m0` REWORK placeholder.
2. **PR2 — bootstrap-doctor:** Node/pnpm bootstrap, Compose, migration, seed, Fake Provider, readiness, setup/doctor/up/down/logs; covers M0-T01/T02.
3. **PR3 — definition-versioning:** JSON schema, field-level errors, canonical hash, import API, immutable Workflow and Agent versions; covers M0-T03/T04.
4. **PR4 — async-happy-path:** Run API, PostgreSQL queue and lease, worker, node/attempt/event persistence, Pi adapter, node-level bindings, and Markdown output; covers M0-T05.
5. **PR5 — failure-crash-persistence-redaction:** auth, timeout, empty output, worker loss, restart persistence, downstream skip, and secret redaction; covers M0-T06/T07/T07E/T08/T09/T11.
6. **PR6 — readonly-web-shell-and-e2e:** temporary UI and Playwright user flows against the complete Compose stack; covers M0-T10.
7. **PR7 — support-acceptance-actions:** smoke test, support bundle, complete `verify-m0`, CI evidence, and three-run release gate; covers M0-T12.
8. **PR8 — m0-closeout:** actual design differences, limitations, risks, rollout, retrospective, and release notes.

Every functional PR preserves RED-before-GREEN evidence, receives independent verification, and merges before the next PR starts from the latest `main`.

PR7a was added after PR7 as a scoped hardening PR. It moved provider credentials to the worker-only environment boundary, made binding failures deterministic, and pinned runner, Actions, Node image, and PostgreSQL image identities without adding product scope.

## As-built M0

The implementation is a Node.js 22 / pnpm 11.13.0 application with TypeScript 7.0.2, Next.js 16.2.10, React 19.2.7, TypeBox 1.3.6, PostgreSQL through `postgres` 3.4.9, Pi Agent 0.73.1, Vitest 4.1.10, and Playwright 1.61.1. The application and worker share one digest-pinned Node 22 image; release acceptance runs on `ubuntu-24.04`.

The Compose topology has exactly five services:

1. `app` serves the Next.js Web shell and API.
2. `worker` claims PostgreSQL queue leases and is the only service that resolves provider credentials or calls Pi.
3. `postgres` persists definitions, Runs, events, queue state, and Markdown.
4. `migrate` applies four ordered, idempotent SQL migrations and their seed rows.
5. `fake-provider` supplies deterministic success and failure modes for acceptance.

The eight public API routes are:

- `GET /api/workflows`
- `POST /api/workflows/import`
- `GET /api/workflows/:id`
- `GET /api/workflows/:id/runs`
- `POST /api/runs`
- `GET /api/runs/:id`
- `GET /api/health/live`
- `GET /api/health/ready`

The ten M0 product and queue tables are `workflows`, `workflow_definition_versions`, `agent_definitions`, `agent_definition_versions`, `workflow_runs`, `node_runs`, `node_run_attempts`, `agent_executions`, `execution_events`, and `queue_jobs`. `schema_migrations` is a separate migration bookkeeping table. The four migration files are `001_bootstrap.sql`, `002_definition_versions.sql`, `003_async_runtime.sql`, and `004_terminal_failures.sql`.

`POST /api/runs` transactionally creates the queued Run, three Node Runs, first event, and queue job, then returns `202`. A worker claims the lease and executes `input.prompt -> process.agent -> output.markdown` through the dedicated Pi Runtime Adapter. A successful Run persists three single Attempts, one Agent Execution, eleven append-only events, the per-Agent provider snapshot, and Markdown output. Failure and crash paths persist safe errors, a skipped Output, and an explicit terminal Run without requeueing or replaying the model request.

The temporary Web shell delivers Workflow List, JSON Import, Workflow Detail, a neutral read-only Board, a right-side Run Sheet, status-text History, polling Run Detail, Markdown Output, `Run again`, and actionable failure explanations. Playwright exercises these flows in Chromium against the complete five-service stack, including light, system-dark, and narrow layouts.

`make verify-m0` runs the unit, PostgreSQL integration, Compose system, and Playwright layers once, produces all thirteen blocking results including M0-T07E, creates a redacted Support Bundle, and seals the Evidence Bundle with `MANIFEST` and `SHA256SUMS`.

## Actual differences from the initial plan

- M0 pulled forward the smallest immutable `AgentDefinitionVersion`, one Attempt per executed node, one Agent Execution, and basic append-only events from the broader M1 governance model. Multiple Attempts, Retry, event streaming, and full Agent governance were not pulled forward.
- Provider empty output became the additional blocking case M0-T07E. It terminates as `provider_empty_output`; it cannot be mistaken for successful blank Markdown.
- Worker loss uses conservative durable dispatch markers. Before dispatch it becomes `worker_lost`; after dispatch and before result persistence it becomes `outcome_unknown`. Neither path replays a model request, even though the v0.4 source allowed recovery or explicit failure.
- Seed data is applied idempotently inside `001_bootstrap.sql` and `002_definition_versions.sql`; there is no separate seed service beyond the five-service topology.
- `WORKFLOW_ENV_FILE` is loaded only by the worker container. The app receives the binding-file path but no credential environment value; provider snapshots retain only alias, provider, effective model, and non-secret parameters.
- Supply-chain hardening added immutable Node/PostgreSQL image digests, commit-pinned Actions, and an `ubuntu-24.04` runner after the initial bootstrap used stable tags. Acceptance captures the actual container identities before cleanup.
- TypeScript 7.0.2 and Next.js 16.2.10 require the two-stage `compile` then `generate` build described below. This is a compatibility workaround, not an application architecture choice.

## Toolchain Compatibility

TypeScript 7.0.2 no longer ships the legacy `typescript/lib/typescript.js` compiler API file that Next.js 16.2.10 checks during a standard build. Until a stable Next.js release supports that package layout, the build runs Next.js `compile`, then `tsc --noEmit`, then Next.js `generate`. No shim, prerelease dependency, or TypeScript downgrade is used.

## Deferred

Builder, Feishu, Logic/Loop, Human Interaction, Tool Gateway, Memory, product-level Subagent support, arbitrary code, multi-user/RBAC, Temporal or another Durable Execution backend, SSE, Retry/Cancel, multiple Attempts, Replay/Compare, complete Agent governance, and product Evidence/Artifact browsing are outside M0.

A dedicated `ModelProvider` interface, a DeepSeek adapter, and opt-in live-model evaluation are follow-up work after `m0-v0.1.0`. M0's release gate remains deterministic and Fake Provider-only; real-model quality or transport behavior is not claimed by this milestone.
