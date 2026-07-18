# Bounded roadmap

The current milestone is the minimal editor described in this package. Work
should advance one bounded child at a time and keep the four-node contract
stable.

## Current

- CRUD and immutable versioning.
- Visual and JSON authoring for `workflow/v1alpha1`.
- Recursive conditions, branch selection, and joins.
- Agent/Skill/MCP snapshot boundary and Pi non-execution of MCP.
- Read-only run projection with selected/skipped statuses.
- One PR Gate with typecheck, unit contracts, and one Compose-stack Playwright
  E2E; the screenshot review passed.

## Next, only when explicitly approved

- richer resource management and audit views;
- durable execution and recovery;
- human interaction or external tools;
- collaboration and publication controls.

These are not implied by completion of the current editor and must not be
represented as implemented by filenames, plans, or historical evidence.
