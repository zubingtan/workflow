# M0 Rollout Plan

## Preconditions

- PR1 through PR8 are merged sequentially and the candidate is the current, reviewed `main` commit.
- `make verify-m0` is green for the PR head, the thirteen source artifacts still match their recorded SHA256 values, and no local or unreviewed change is part of the candidate.
- Documentation, four migrations, Fake Provider modes, worker-only provider credential boundary, Support Bundle redaction, and Requirement-to-Test-to-Evidence traceability match the shipped implementation.
- The exact final `main` Git SHA is known. Tag `m0-v0.1.0` and the private GitHub Release do not exist before the release gate passes.

## Release Procedure

1. Trigger `.github/workflows/m0-release-gate.yml` once with `workflow_dispatch`, passing the exact final `main` SHA in `git_sha`.
2. Let `validate` prove that the requested commit is current `main` and that this is workflow attempt 1.
3. Let the workflow chain `run1 -> run2 -> run3` sequentially through job dependencies. Each job checks out the same SHA and invokes the reusable M0 acceptance workflow on an independent clean `ubuntu-24.04` runner with an isolated Compose project and database volume.
4. After all three pass, let `aggregate` download and validate the three Evidence Bundles, confirm their identical SHA and secret scans, and generate aggregate `MANIFEST` and `SHA256SUMS` files.
5. Inspect the aggregate evidence and record the final SHA, release-gate workflow URL, and aggregate artifact URL in the release record.
6. Create the private `m0-v0.1.0` tag at that verified SHA and publish the private GitHub Release using the closeout notes. Neither action occurs automatically in the verification workflow.

## Failure and REWORK

Any failure in `validate`, `run1`, `run2`, `run3`, evidence validation, or aggregation invalidates the entire series and leaves the candidate `REWORK`. A later job cannot run around a failed dependency, a partial pass is not reusable, and a GitHub Actions rerun does not count as another consecutive pass.

Repair requires a new TDD PR and merge, which produces a new final `main` SHA. Start a fresh single `workflow_dispatch` at `run1`; do not amend the failed release candidate, force a tag, or publish an incomplete Release.

If an already published local deployment cannot preserve explainable Run history or the credential boundary, stop app and worker traffic, retain PostgreSQL and the redacted Support Bundle, and investigate from immutable evidence. M0 rollback never retries an unknown model outcome: interrupted Runs remain terminal `worker_lost` or `outcome_unknown` according to persisted dispatch facts.

## Current release readiness

- Final same-SHA three-run acceptance: **PENDING**, awaiting PR8 merge and one release `workflow_dispatch`.
- Tag `m0-v0.1.0`: **PENDING**, created only after aggregate evidence review.
- Private GitHub Release: **PENDING**, published only after the tag points to the verified final SHA.
