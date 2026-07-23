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
`baseUrl`, `model`, and the **name** of an env var holding the API key
(`provider_api_key_env`). Set that env var, restart `pnpm server`. The key
itself is never stored — only the env var name.

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
   CORS is enabled for the dev origin; `GET /env/vars` (autocomplete helper) is
   restricted to localhost origins.
3. **pi-coding-agent → provider** — each run creates an agent session
   (`createAgentSession`) with an in-memory session/settings manager and a
   dynamically registered provider pointing at the agent's `provider_base_url`.
   The API key is resolved from `process.env[agent.provider_api_key_env]` at
   call time.

```
canvas LLM node → localhost:4001/agents/:id/run (Hono, SSE)
  → createAgentSession (pi-coding-agent) → provider baseUrl (fake-provider:4010 or real)
```

## Critical conventions

- **Persistence lives in `~/.config/workflow/`** — `workflow.db` (SQLite, WAL)
  and `agents/` (agent workspace). Nothing deployment-specific is stored inside
  the repo. Tables are created with `CREATE TABLE IF NOT EXISTS` (no migration
  machinery by design).
- **Credentials**: an agent record stores `provider_api_key_env` (env var name),
  never the key. The backend resolves `process.env[...]` at call time.
- **Do not run pi in the browser** — it is Node-only (`fs` / `process` / HTTP;
  CORS + key exposure). The frontend never imports pi; it only calls the Hono
  backend.
- **`.env` is gitignored**; `.env.example` is the committed template. `cp` it
  before running. `PUBLIC_SERVER_URL` is inlined into the client bundle by
  RSBuild (frontend → backend URL).
- **pnpm only** (not npm/yarn). `packageManager: pnpm@11.13.0`. Build-script
  allowlist lives in `pnpm-workspace.yaml` (`onlyBuiltDependencies`), NOT in
  `package.json`'s `pnpm` field (pnpm 11 ignores that field). `better-sqlite3`
  must be listed there so its native binding builds.

## Commands

```bash
pnpm dev              # rsbuild dev only (frontend, --open)
pnpm server           # Hono backend only (needs .env)
pnpm fake-provider    # fake provider only (needs .env)
pnpm dev:all          # all three via concurrently
pnpm build:prod       # production rsbuild build
pnpm ts-check         # tsc --noEmit
pnpm lint             # eslint ./src --cache
```

## Key files

- `src/app.tsx` — app shell: sidebar (Workflows / Agents), editor view, Save Workflow.
- `src/manage.tsx` — Workflow / Agent CRUD managers + agent form (env-var autocomplete, Test).
- `src/api.ts` — HTTP client to the backend (`SERVER_URL`).
- `src/nodes/llm/index.ts` + `form-meta.tsx` — LLM node registry and form (agentId + prompt).
- `server/index.mjs` — Hono app: agents/workflows CRUD, agent run/test SSE, `/env/vars`, `/health/live`.
- `scripts/fake-provider.mjs` — OpenAI-compatible fake (port 4010, SSE + test control).
- `.env.example` — `FAKE_PROVIDER_API_KEY` / `SERVER_PORT` / `FAKE_PROVIDER_PORT` / `PUBLIC_SERVER_URL`.
- `rsbuild.config.ts` — Rsbuild config.
- `pnpm-workspace.yaml` — `onlyBuiltDependencies`.

## PR merge

This repo only allows **rebase merges** (`gh pr merge --rebase`). Merge
commits and squash merges are disabled — don't attempt them.

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
