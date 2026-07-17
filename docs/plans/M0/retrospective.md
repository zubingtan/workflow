# M0 Retrospective

> Historical M0 record: full acceptance evidence remains release-only; it is no longer the pull-request gate.

## Outcome

M0 product scope is implemented through PR7a and PR8 closeout is under review. The latest completed full PR acceptance evidence is run `29443302168` at exact head `f7a6a83265929d1f4c31cd46910b62131e9cf7f1`, attempt 1: all `13/13` blocking cases passed and artifact `8354551937` was uploaded with ZIP SHA256 `914891b3647ca78c3a2ac57d405ef2f2e1db7017cdf4767280f197c110df6c59`. This proves the implemented gate at that PR head; it is not the milestone release gate for the final post-PR8 `main` commit.

- Final same-SHA three-run gate: **PENDING**, awaiting PR8 merge and one release `workflow_dispatch`.
- Tag `m0-v0.1.0`: **PENDING**, awaiting three valid bundles and aggregate review.
- Private GitHub Release: **PENDING**, awaiting the verified tag and final evidence URLs.

The delivered behavior is a local five-service stack that imports immutable three-node Definitions, asynchronously runs a Pi Agent in the worker, stores one Attempt per executed node (three on the happy path) and explainable events, persists Markdown and history, terminalizes Provider/worker failures without replay, exposes a read-only Web shell, and generates redacted acceptance/support evidence.

## What Worked

The sequential TDD slices kept failures attributable. PR3's final run `29363243851` proved 54 compiler tests and 16 real-PostgreSQL API/version tests; PR4 run `29368111393` proved one claim and one model call with two workers; PR5 run `29372934798` made all five safe terminal errors, restart persistence, and no-replay behavior explicit.

The browser shell was tested as a real product path rather than a screenshot mock. PR6 run `29385102802` completed 8/8 jobs, including four Playwright journeys against Next.js, worker, PostgreSQL, migrations, and Fake Provider, with light, dark, and narrow screenshots. PR7 run `29435853723` then exercised the single reusable acceptance job and produced 13/13 PASS/GO evidence at the exact PR head.

Provider Binding stayed per Agent node throughout. PR7a isolated credentials to the worker, captured actual runner/container identities, pinned the supply chain, and kept API, database, logs, DOM, and nested evidence free of the injected sentinel. Immutable Definition/Agent versions plus stored effective-model snapshots make historical Runs explainable without exposing Pi Session IDs or provider transport details.

## What Required Rework

Several GREEN attempts found real compatibility or harness defects and were repaired through new commits rather than reruns. PR2 corrected a PostgreSQL assertion that constant-folded `1/0`, and adopted the Next.js `compile`/`generate` two-stage build for TypeScript 7. PR3's independent review found unsafe Provider Binding configuration classification, leading to seven isolated RED cases before final GREEN.

PR4 run `29367820205` exposed PostgreSQL 18's missing `jsonb_object_length(jsonb)` and replaced it with an equivalent constraint. PR5's first implementation surfaced lost assertion failures in the crash harness and a mismatch between string prompts and Pi content-part arrays; `05fa563` and `12cb209` fixed the harness and Fake Provider parser without weakening the terminal-state contract.

PR6 needed two evidence-only corrections: `b7d424e` preserved observation of `running`, and `6242cc1` classified the intentional invalid-import HTTP 400 while retaining every unexpected-console failure. PR7a's first GREEN gate reached 12/13 because JSON serialization compared provider snapshots by key order; `33985b2` changed only that harness comparison to structural equality, after which run `29442519995` passed 13/13.

## Residual Risks and Deferred Work

The main release risk is procedural: the final PR8 `main` SHA has not yet completed the required three clean, sequential acceptance runs, so no milestone tag or Release claim is valid. The TypeScript 7 / Next.js 16 build still depends on experimental two-stage build modes and should be removed when stable compatibility is available.

Runtime scope is intentionally narrow. Each executed node has one Attempt; there is no Retry, Cancel, SSE, Replay, Human Interaction, durable waiting, or Builder. `outcome_unknown` preserves honesty after a possible provider dispatch but requires operator judgment and a separate new Run. M0 also proves deterministic Fake Provider behavior, not real-model quality, rate-limit behavior, or a vendor-specific production transport.

The temporary Web shell is sufficient for import, run, history, and failure diagnosis, but it is not a future Builder design commitment. Multi-user/RBAC, production secret management, product Evidence browsing, and broader Agent governance remain outside this local milestone.

## Follow-up Decisions

- **Model provider boundary:** backend runtime owner; after `m0-v0.1.0`, introduce a small `ModelProvider` interface, implement a DeepSeek OpenAI-compatible adapter, and run an opt-in live-model contract covering success, auth failure, timeout, empty output, redaction, and exact call count. This is deferred because v0.4 requires ordinary CI to stay deterministic and Fake Provider-only.
- **Build compatibility:** bootstrap owner; on each stable Next.js or TypeScript update, run `pnpm typecheck`, the production build, and full `make verify-m0` before replacing the two-stage workaround. M0 does not justify changing its exact dependency baseline during closeout.
- **Reliable runtime:** M1 owner; validate multiple Attempts, safe Retry boundaries, Cancel, SSE resume, Replay/Compare, backup/restore, and a Durable Execution spike through the M1 acceptance matrix. These behaviors require new state/event contracts and cannot be inferred from M0's single-Attempt no-replay model.
- **Product UI evolution:** product owner; use observed M0 import/run/history behavior and later M4 Builder testing to decide the editable workflow experience. The M0 right-side Run Sheet remains an operational shell, so extending it now would create an unsupported product commitment.
