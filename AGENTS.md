# Repository instructions

These instructions apply to the repository. When a task conflicts with the
`workflow/v1alpha1` contract, stop and surface the ambiguity before editing.

## Quick start

Fresh checkout or missing local image (setup/build may exceed 30 seconds):

```bash
pnpm doctor
pnpm setup
pnpm dev
```

Warm daily startup (30 seconds or less):

```bash
pnpm dev
```

`pnpm dev` is the sole daily full-stack start. It starts PostgreSQL, migrations,
the app, worker, and Fake Provider without rebuilding, applies one 30-second
deadline to Compose and the final readiness request, and prints the exact URL.
The default URL and readiness endpoint are:

```text
http://127.0.0.1:3000
http://127.0.0.1:3000/api/health/ready
```

Use `pnpm dev:build` only when source or dependency changes require an image
rebuild; like setup, build may exceed 30 seconds. Use `pnpm logs` for service
logs and `pnpm down` to stop the stack. Make targets are thin aliases for the
same pnpm commands.

## Configuration modes

The normal path is safe and deterministic:

- `pnpm dev` uses only `.env.example` and
  `config/provider-bindings.fake.json`.
- It never reads `.env` or `.env.local`, and never rebuilds.
- `APP_PORT=<port> pnpm dev` is the supported non-default port override.
- `WORKFLOW_IMAGE_TAG=<existing-tag> pnpm dev` may select an already prepared
  local image without changing provider configuration.
- Compose passes only named variables to services. Worker provider config is
  mounted read-only.

Real-provider mode is an explicit local opt-in:

```bash
cp config/provider-bindings.example.json config/provider-bindings.local.json
printf 'REAL_PROVIDER_API_KEY=replace-me\n' > .env.local
pnpm dev:real
```

Edit the local JSON base URL and model, but keep
`apiKeyEnv: "REAL_PROVIDER_API_KEY"`. `.env.local` overrides the checked-in
safe defaults only in real mode. Both local files are ignored by Git. Never
read, print, commit, or copy credential values into JSON, logs, tests, or chat.

## Scope and simplicity

- Make the smallest change that satisfies the request.
- Preserve unrelated edits already in the worktree.
- Do not add unsupported node types, speculative APIs, release machinery, or
  historical milestone language.
- Write a deterministic failing test before behavior changes, then implement
  the minimum GREEN change without weakening test intent.

## Active product boundaries

- Versioned JSON is the definition source of truth.
- Node types are `input.prompt`, `task.agent`, `logic.condition`, and
  `output.markdown`.
- Conditions are recursive and deterministic.
- Agent, Skill, and MCP references are immutable authoring snapshots.
- Pi runs behind an adapter; MCP metadata is not executed.
- Runtime projections distinguish selected, skipped, and joined work.

## Orchestration and verification

- The main agent decomposes and delegates bounded work; write-capable agents
  must have non-overlapping ownership and must preserve concurrent edits.
- Product code and tests use Terra; scouting and documentation may use Luna.
- At most one write-capable subagent works at a time, and child agents do not
  spawn children.
- Run focused unit tests and `pnpm typecheck` for product changes. The single
  browser E2E is documented in
  `docs/09-MILESTONE-AUTOMATED-ACCEPTANCE.md`.
- For documentation changes, run a repo-wide stale-reference scan and
  `git diff --check`.
- Keep `docs/design-qa.md` as `final result: pending` until screenshots have
  actually been reviewed.
