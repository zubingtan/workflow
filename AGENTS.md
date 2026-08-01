# Repository instructions

FlowGram workflow editor + Hono backend. Frontend: canvas + management shell
(`src/`, React 18, Rsbuild). Backend: SQLite persistence + agent execution
(`server/`, Hono). LLM nodes run as pi-coding-agent sessions against an
OpenAI-compatible provider.

## Start working

```bash
scripts/create-worktree.sh <type> <name>   # feat|fix|chore|research|docs
cd .worktrees/<name>
pnpm dev
```

The script handles everything: fetches latest main, enforces Node 22,
runs `pnpm install`, and generates an isolated `.env`.

## Ports

| Context                     | Server  | Fake provider | Data dir                         |
| --------------------------- | ------- | ------------- | -------------------------------- |
| **Main working dir** (dev)  | :4001   | :4010         | `~/.config/workflow-dev/`        |
| **Worktree** (auto-derived) | :4001+N | :4510+N       | `~/.config/workflow-dev-<name>/` |
| **Prod**                    | :4000   | —             | `~/.config/workflow/`            |
| **E2E**                     | :4099   | :4011         | temp dir                         |

N = CRC32(worktree name) % 500. Printed at worktree creation time.
Explicit `PORT` / `FAKE_PROVIDER_PORT` / `WORKFLOW_DATA_DIR` env vars
always override.

Health checks: `GET /health/live` on both server and fake-provider.

## Commands

```bash
pnpm dev              # fake-provider + dev server (default for most tasks)
pnpm dev:server       # dev server only (no fake-provider)
pnpm build            # production build → dist/
pnpm start            # prod server (:4000)
pnpm ts-check         # tsc --noEmit
pnpm lint             # eslint ./src --cache
pnpm test             # node --test (unit tests in test/)
pnpm test:e2e         # playwright (requires pnpm build first)
```

Wait for both health checks before declaring "dev server is up".
Default to `pnpm dev` for anything touching LLM/agent behavior.

## Hard constraints

- **Node 22 only.** Enforced by `engines` + `engine-strict` + `check-node.mjs`
  on all dev/build/start scripts. Never run under Node 25 (no better-sqlite3
  binding, non-LTS).
- **pnpm only** (not npm/yarn). `packageManager: pnpm@11.13.0`.
- **Rebase merges only** (`gh pr merge --rebase`). No merge commits, no squash.
- **All work in worktrees.** Main working dir stays on `main`. Never
  `git checkout -b` here.
- **Before PR**: `scripts/sync-branch.sh` (rebase onto latest main). CI
  enforces via `require-branch-built-on-latest`.
- **After merge**: `scripts/remove-worktree.sh <name>`.
- **Frontend never imports pi-coding-agent** — it is Node-only. Frontend
  calls the Hono backend via same-origin relative URLs.
- **`.env` is gitignored.** Template: `.env.example`.

## Architecture (one picture)

```
Browser (src/)
  → same-origin HTTP → Hono (server/app.mjs)
    → agents CRUD, workflows CRUD, runs queue, settings
    → agent execution: createAgentSession (pi-coding-agent)
      → config.provider.base_url (fake-provider:4010 or real)
    → workflow runs: serial queue → FlowGram TaskRunAPI
```

Key backend files: `server/index.mjs` (entry), `server/app.mjs` (routes),
`server/queue.mjs` (run queue), `server/runtime-adapter.mjs` (FlowGram +
mem0 binding), `server/settings.mjs` (runtime settings).

## Scope and simplicity

- Smallest change that satisfies the request.
- Failing test before behavior changes; minimum GREEN implementation.
- Run `pnpm ts-check` and `pnpm lint` for product changes.
- Do not add speculative node types, APIs, or release machinery.

## Semi UI components

When touching `@douyinfe/semi-ui` code (50+ files), consult the
`semi-design` skill (`.agents/skills/semi-design/`). Dark mode:
`body[theme-mode="dark"]`. If Semi MCP is configured, prefer its tools
(version `2.101.1`).

## Issue tracker

GitHub Issues (`zubingtan/workflow`) via `gh` CLI.
See `docs/agents/issue-tracker.md`. Domain docs: `CONTEXT.md` + `docs/adr/`.
