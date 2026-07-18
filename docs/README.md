# Workflow editor contract

This is the current product documentation for the minimal
`workflow/v1alpha1` editor. It describes behavior that the code and tests must
share; it is not a release plan or historical report.

## Scope

- Workflow CRUD and immutable definition versioning.
- Visual graph editing plus direct JSON authoring.
- Four node types: `input.prompt`, `task.agent`, `logic.condition`, and
  `output.markdown`.
- Agent, Skill, and MCP version references captured at the authoring boundary.
- Read-only test runs with selected, skipped, and join semantics.

Out of scope: arbitrary code, runtime MCP execution, human interaction,
loops, multi-user collaboration, and release evidence bundles.

## Navigation

- [01-PRD.md](01-PRD.md) — user value and acceptance contract.
- [02-DESIGN-DOC.md](02-DESIGN-DOC.md) — schema, API, and runtime boundary.
- [03-ADR.md](03-ADR.md) — durable architectural decisions.
- [04-ROADMAP.md](04-ROADMAP.md) — only the next bounded product increments.
- [07-WORKFLOW-TESTING-UX.md](07-WORKFLOW-TESTING-UX.md) — test-mode UX.
- [09-MILESTONE-AUTOMATED-ACCEPTANCE.md](09-MILESTONE-AUTOMATED-ACCEPTANCE.md) —
  one PR Gate and one E2E.
- [design-qa.md](design-qa.md) — screenshot acceptance checklist.

## Requirement → test → evidence

| Requirement | Primary test | Evidence |
|---|---|---|
| `workflow/v1alpha1` validation and recursive conditions | compiler and scheduler contract tests | test output and JSON fixture |
| CRUD, versioning, visual/JSON authoring | workflow builder E2E | screenshot and run assertion |
| Agent/Skill/MCP snapshot and Pi non-execution boundary | resource/runtime boundary tests | captured version refs and adapter assertions |
| selected, skipped, and join behavior | scheduler/runtime tests and builder E2E | node status projection |
| PR quality gate | repository PR Gate | typecheck, unit contracts, and one Playwright E2E on Compose/PostgreSQL/Fake Provider/Chromium |

The screenshot review passed on the recorded real Compose-stack Chromium
evidence; see `design-qa.md`.
