# M0 v0.1.0 Release Notes

These notes describe the `m0-v0.1.0` candidate. Publication remains gated by the final same-SHA three-run acceptance workflow.

## Delivered

- A five-service local Compose stack: Next.js app, independent worker, PostgreSQL, migration, and deterministic Fake Provider.
- Immutable Workflow and minimal Agent Definition Versions for the fixed `input.prompt -> process.agent -> output.markdown` JSON DSL.
- Asynchronous `202` Run creation, PostgreSQL queue/lease ownership, Pi Agent 0.73.1 execution in a dedicated adapter, one Attempt per executed node, append-only events, and persisted Markdown.
- Node-level Provider Bindings with configured/effective model facts and worker-only credential resolution; there is no global Provider.
- Safe terminal errors for Provider auth, timeout, empty output, pre-dispatch worker loss, and uncertain post-dispatch outcome. Downstream Output is skipped and the model call is never automatically replayed.
- An Apple-minimal, system-dark, responsive Web shell with Workflow List, JSON Import, read-only Board, right-side Run Sheet, History, polling Run Detail, `Run again`, Markdown Output, and failure explanations.
- One-command 13-case acceptance, real-stack Chromium E2E, redacted Support Bundles, container identity/digest evidence, and sealed `MANIFEST` / `SHA256SUMS` evidence.

## Operations

Use `make setup`, review the local Provider Binding, run `make doctor`, then start with `make up` and open <http://localhost:3000>. Enter the Prompt from Workflow Detail by opening **Run workflow**; the input is in the right-side **Run Sheet**. Use `make logs`, `make smoke-test`, `make support-bundle`, `make verify-m0`, and `make down` for diagnosis, acceptance, and cleanup.

CI and release acceptance use only the deterministic Fake Provider. A real HTTPS OpenAI-compatible binding can be configured locally by alias, but its credential must remain in the ignored worker environment file and must never be placed in the Definition, binding JSON, browser, or evidence.

## Known limitations

- The Board is read-only; Builder and arbitrary workflow shapes are not included.
- There is no Retry/Cancel, multiple Attempts, Replay/Compare, or automatic recovery of an unknown model outcome.
- There is no SSE, waiting, Human Interaction, Logic/Loop, Tool Gateway, Memory, Feishu, Temporal, multi-user/RBAC, product Evidence browser, or production secret-management surface.
- The TypeScript 7.0.2 / Next.js 16.2.10 build uses experimental two-stage `compile` and `generate` modes.
- M0 validates platform behavior with the Fake Provider. A dedicated `ModelProvider` interface, DeepSeek adapter, and live-model evaluation are post-release follow-up and are not part of this candidate's acceptance claim.

## Validation and release status

The latest pre-closeout full PR acceptance is run `29443302168` at exact head `f7a6a83265929d1f4c31cd46910b62131e9cf7f1`, attempt 1. It reported 13/13 PASS/GO and uploaded artifact `8354551937` with ZIP SHA256 `914891b3647ca78c3a2ac57d405ef2f2e1db7017cdf4767280f197c110df6c59`. It demonstrates the implemented suite at the PR7a head, not the required release proof for the final PR8 merge SHA.

- Final three-run same-SHA gate: **PENDING**, awaiting one `workflow_dispatch` at the final `main` Git SHA.
- Tag `m0-v0.1.0`: **PENDING**, awaiting valid `run1`, `run2`, `run3`, and aggregate evidence.
- Private GitHub Release: **PENDING**, awaiting the verified tag and evidence review.

The release workflow must use three sequential, isolated clean runners at the same SHA. Any failure makes the series `REWORK`; reruns do not count. The final exact SHA, workflow URL, aggregate artifact URL, tag, and Release URL are recorded by release evidence only after this gate succeeds.
