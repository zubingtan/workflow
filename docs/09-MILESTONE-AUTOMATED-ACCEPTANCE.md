# Automated acceptance

The repository has one PR Gate.

## PR Gate

The gate runs typecheck → focused unit contracts → one Playwright E2E. The
focused contracts cover schema validation, recursive conditions, resource
snapshots, runtime boundaries, and scheduler semantics. The Playwright journey
runs on the normal Compose stack with PostgreSQL, the Fake Provider, and
Chromium. It covers create/open workflow, visual editing, JSON inspection,
saving a new version, and both conditional run routes with selected and
skipped nodes plus Markdown output. These services and the browser journey are
part of the ordinary PR Gate.

## Evidence mapping

The test output is the machine evidence. Browser screenshots are visual
evidence when recorded in [design-qa.md](design-qa.md).
