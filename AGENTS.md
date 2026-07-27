# Repository instructions

These instructions apply to the repository. When a task conflicts with the
architecture below, stop and surface the ambiguity before editing.

## Project

FlowGram free-layout workflow editor (demo-free-layout, 13 node types) + a Hono
backend that runs LLM nodes as **pi-coding-agent sessions**. The frontend is the
canvas plus a management shell (Workflows / Agents); the backend persists agents
and workflows in SQLite and executes agent sessions against an OpenAI-compatible
provider (fake-provider for dev, real provider for prod).

## Quick start

Toolchain (new shells):

```bash
source ~/.nvm/nvm.sh
nvm use 22          # node 22.23.1
# pnpm 11.13.0 is enabled via corepack (already activated)
```

Fresh checkout:

```bash
pnpm install
cp .env.example .env
pnpm dev:all        # concurrently: fake-provider(4010) + Hono server(4001) + rsbuild dev(3000)
```

Open http://localhost:3000. The left sidebar manages Workflows and Agents; the
canvas edits a workflow. An LLM node references an **agent** (by id) plus a
prompt; Test Run executes the node through the backend agent session.

Real provider: create an Agent in the UI (or seed one) with the provider
`baseUrl`, `model`, and the **API key value** (`provider_api_key`). The key
is stored directly in the SQLite database and used at call time.

## Architecture (three layers, do not collapse)

1. **FlowGram canvas + management shell (browser)** — `src/`, Rsbuild + React 18
   - Inversify. `src/app.tsx` is the shell (sidebar: Workflows / Agents; editor
     view). `src/manage.tsx` renders the CRUD managers. `src/api.ts` is the only
     HTTP client to the backend. The LLM node (`src/nodes/llm/`) stores
     `agentId` + `prompt` and renders agent output via the backend run endpoint.
2. **Hono backend (Node)** — `server/index.mjs`. Single source of truth for
   persistence and execution: agents + workflows CRUD (SQLite), and
   `POST /agents/:id/run` / `POST /agents/test` which stream **generic SSE
   events** (`content_delta` / `tool_start` / `tool_end` / `finish` / `error`).
   CORS is enabled for the dev origin.
3. **pi-coding-agent → provider** — each run creates an agent session
   (`createAgentSession`) with an in-memory session/settings manager and a
   dynamically registered provider pointing at the agent's `provider_base_url`.
   The API key is read from `agent.provider_api_key` directly at call time.

```
canvas LLM node → localhost:4001/agents/:id/run (Hono, SSE)
  → createAgentSession (pi-coding-agent) → provider baseUrl (fake-provider:4010 or real)
```

## Critical conventions

- **Persistence lives in `~/.config/workflow/`** — `workflow.db` (SQLite, WAL)
  and `agents/` (agent workspace). Nothing deployment-specific is stored inside
  the repo. Tables are created with `CREATE TABLE IF NOT EXISTS` (no migration
  machinery by design).
- **Credentials**: an agent record stores `provider_api_key` (the key value).
  The backend uses it directly at call time.
- **Do not run pi in the browser** — it is Node-only (`fs` / `process` / HTTP;
  CORS + key exposure). The frontend never imports pi; it only calls the Hono
  backend.
- **`.env` is gitignored**; `.env.example` is the committed template. `cp` it
  before running. The frontend talks to the same origin that served it (T3
  removed `PUBLIC_SERVER_URL`; `src/api.ts` uses same-origin relative URLs).
- **pnpm only** (not npm/yarn). `packageManager: pnpm@11.13.0`. Build-script
  allowlist lives in `pnpm-workspace.yaml` (`onlyBuiltDependencies`), NOT in
  `package.json`'s `pnpm` field (pnpm 11 ignores that field). `better-sqlite3`
  must be listed there so its native binding builds.

## Commands

```bash
pnpm dev              # rsbuild dev only (frontend only, port 3000)
pnpm server           # Hono backend only (needs .env, port 4001)
pnpm fake-provider    # fake provider only (needs .env, port 4010)
pnpm dev:all          # all three via concurrently (fake + server + web)
pnpm build:prod       # production rsbuild build
pnpm ts-check         # tsc --noEmit
pnpm lint             # eslint ./src --cache
```

### Dev server startup convention

`pnpm dev` / `pnpm dev:all` no longer pass `--open` to rsbuild — starting
the dev server will NOT auto-open a browser tab. Open http://localhost:3000
manually when you need it.

**Which command to use:**

| Scenario                                                          | Command                            | Why                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Agent starts full-stack dev (LLM node needs backend + provider)   | `pnpm dev:all`                     | One process group, three ports ready                                                                 |
| Agent only iterates on frontend (no agent execution, no Test Run) | `pnpm dev`                         | Lighter; backend & provider not needed                                                               |
| Agent only iterates on backend (SSE, CRUD, no canvas)             | `pnpm server`                      | Frontend not needed                                                                                  |
| Agent runs E2E                                                    | `pnpm build:prod && pnpm test:e2e` | `e2e/global-setup.ts` spawns fake-provider + prod-mode Hono (single port :4001); needs `dist/` first |

**Agent rules:**

- Default to `pnpm dev:all` for any task that touches LLM node behavior,
  agent execution, or anything observable from the canvas. The canvas
  alone is useless without the backend to execute against.
- Use `pnpm dev` (frontend only) for pure-UI work (layout, styling,
  component behavior) where backend interaction is out of scope.
- Never run `pnpm dev` and `pnpm server` / `pnpm fake-provider` in
  separate terminals — use `pnpm dev:all` so the process group is
  managed as one unit.
- After startup, wait for the three ports to be ready before declaring
  "dev server is up":
  - http://localhost:4010/health/live (fake-provider)
  - http://localhost:4001/health/live (Hono server)
  - http://localhost:3000 (rsbuild dev — any HTTP response is fine)

## Key files

- `src/app.tsx` — app shell: sidebar (Workflows / Agents), editor view, Save Workflow.
- `src/manage.tsx` — Workflow / Agent CRUD managers + agent form (API key input, Test).
- `src/api.ts` — HTTP client to the backend (`SERVER_URL`).
- `src/nodes/llm/index.ts` + `form-meta.tsx` — LLM node registry and form (agentId + prompt).
- `server/index.mjs` — Hono app: agents/workflows CRUD, agent run/test SSE, `/health/live`.
- `scripts/fake-provider.mjs` — OpenAI-compatible fake (port 4010, SSE + test control).
- `.env.example` — `FAKE_PROVIDER_API_KEY` / `SERVER_PORT` / `FAKE_PROVIDER_PORT`.
- `rsbuild.config.ts` — Rsbuild config.
- `pnpm-workspace.yaml` — `onlyBuiltDependencies`.

## PR merge

This repo only allows **rebase merges** (`gh pr merge --rebase`). Merge
commits and squash merges are disabled — don't attempt them.

## Worktree policy

All feature/fix/chore work must happen in a **git worktree**, not on a
new branch checked out in the main working directory.

- **Main working directory** (`/home/zubingtan/Projects/workflow`) stays
  on `main` and is used only for: pulling latest `main`, running dev
  servers for ad-hoc checks, and creating new worktrees. **Never** run
  `git checkout -b <feature>` here.
- **Create a worktree** for every piece of work:
  ```bash
  git worktree add -b <type>/<name> .worktrees/<name> main
  ```
  - `<type>` ∈ `feat` | `fix` | `chore` | `research` | `docs`
  - `<name>` is kebab-case, short
  - Worktrees live under `.worktrees/` (gitignored — see `.gitignore`)
- **Work in the worktree**: edit, commit, push, open PR from there.
- **Cleanup after merge**: `git worktree remove .worktrees/<name>` and
  delete the branch (`git branch -D <type>/<name>`).
- **Why**: keeps `main` working tree clean and always on `main` so the
  dev server reflects the merged state; lets multiple work streams run
  in parallel without stashing; avoids accidental commits to `main`.

## Scope and simplicity

- Make the smallest change that satisfies the request.
- Preserve unrelated edits already in the worktree.
- Do not add speculative node types, APIs, or release machinery.
- Write a deterministic failing test before behavior changes, then implement
  the minimum GREEN change without weakening test intent.
- Run `pnpm ts-check` and `pnpm lint` for product changes.

## Background (planning artifacts, not in this repo)

Full decision log, SSE streaming protocol, and pi SDK migration notes live in
`/home/zubingtan/projects/wayfinder/MAP.md`. Reference files (old repo's pi
adapter, worker, contracts) at `/home/zubingtan/projects/wayfinder/reference/`.
Old repo full clone backup at `/home/zubingtan/projects/wayfinder/old-clone-backup/`.
Consult MAP.md before non-trivial architecture work.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`zubingtan/workflow`) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Semi UI components

When writing or modifying code that uses `@douyinfe/semi-ui` / `@douyinfe/semi-icons` (50+ files already import it), consult the `semi-design-guide` skill (files in `.agents/skills/semi-design/`). It covers component import conventions, theme customization (CSS variable override path, which `--semi-color-*` / `--semi-border-radius-*` variables exist), dark mode (`body[theme-mode="dark"]`), and the MCP-tool query workflow. If Semi MCP (`@douyinfe/semi-mcp`) is configured in the environment, prefer its `get_semi_document` / `get_component_file_list` / `get_file_code` / `get_function_code` tools (pass version `2.101.1`) for authoritative component knowledge; otherwise fall back to the skill's built-in guidance and the project-specific theme decisions recorded in issue #70 (D2).
