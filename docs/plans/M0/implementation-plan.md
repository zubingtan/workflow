# M0 Implementation Plan

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

## Deferred

Builder, Feishu, Logic/Loop, Human Interaction, Tool Gateway, Memory, product-level Subagent support, arbitrary code, multi-user/RBAC, Temporal, SSE, Retry/Cancel, Replay/Compare, and product Artifact browsing are outside M0.
