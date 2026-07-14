# M0 Rollout Plan

## Preconditions

- PR1 through PR8 are merged sequentially with required checks passing.
- The final `main` SHA has no unreviewed changes and all dependencies and container images are pinned.
- Documentation, migration, Fake Provider scenarios, support-bundle redaction, and requirement-to-test-to-evidence traceability match the shipped implementation.

## Release Procedure

1. Run the release workflow three times in sequence on independent clean runners using the same `main` SHA and isolated Compose projects.
2. Require each run to execute the full `make verify-m0` suite and upload a complete evidence bundle.
3. Aggregate the three bundles with a manifest and SHA256 checksums, then confirm secret scans and terminal-state invariants.
4. Publish the private `m0-v0.1.0` tag and release notes only after the three-run gate passes.

## Rollback and Rework

If any blocking test fails, mark the candidate `REWORK`, do not publish or reuse a partial pass, and repair the defect through a new PR. If a released deployment cannot preserve explainable Run history or secret boundaries, stop it, retain the database and diagnostic evidence, and return to the last accepted release while the fix is reviewed.

M0 rollback never retries an unknown model outcome. Runs interrupted before or after provider dispatch remain explicit terminal failures according to the persisted evidence.
