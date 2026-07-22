# Repository instructions

These instructions apply to the repository. When a task conflicts with the
architecture below, stop and surface the ambiguity before editing.

## Project

FlowGram free-layout workflow editor (demo-free-layout, 13 node types) + a Hono
backend that wraps the pi agent SDK as an OpenAI-compatible `/chat/completions`
facade. The frontend is the canvas; the backend runs pi; pi calls an
OpenAI-compatible provider (fake-provider for dev, real provider for prod).

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

Open http://localhost:3000. Drag an LLM node onto the canvas, click Test Run —
it returns `Fake provider response` (canvas → Hono → pi → fake-provider).

Real provider: edit `config/provider-bindings.json` (`baseUrl` / `apiKeyEnv` /
`model`), set the env var, restart `pnpm server`. Never put credentials in JSON.

## Architecture (three layers, do not collapse)

1. **FlowGram canvas (browser)** — `src/`, Rsbuild + React 18 + Inversify. All
   node UI/registration. The LLM node (`src/nodes/llm/index.ts`) defaults
   `apiHost` to `http://localhost:4001`. Execution happens in
   `@flowgram.ai/runtime-js` (`LLMExecutor` → `ChatOpenAI.invoke` →
   `${apiHost}/chat/completions`); the demo itself has no LLM call code.
2. **Hono backend (Node)** — `server/index.mjs`. `POST /chat/completions`
   (OpenAI-compatible, dual-mode: `stream: true` → SSE via `streamSSE`, else →
   JSON) wraps `runPiAgent` from `server/pi-runtime-adapter.mjs` (non-streaming)
   or `createPiBackend` + `mapAgentEventToSse` (streaming). CORS is enabled
   (`Access-Control-Allow-Origin: *`; SSE responses also set
   `X-Accel-Buffering: no`).
3. **pi agent SDK → provider** — `runPiAgent` uses `new Agent` + `streamSimple`
   against an OpenAI-compatible endpoint described by `config/provider-bindings.json`.
   Credentials resolve via `apiKeyEnv` (env var name in JSON; key never in JSON).

```
canvas LLM node → ChatOpenAI → localhost:4001/chat/completions (Hono)
  → runPiAgent (pi Agent) → streamSimple → provider baseUrl (fake-provider:4010 or real)
```

## Critical conventions

- **pi import**: `streamSimple` is NOT a top-level export of
  `@earendil-works/pi-ai` (moved in 0.80.x). Import it from the per-API stable
  module: `import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";`.
  Do NOT use `@earendil-works/pi-ai/compat` (deprecated, marked for deletion).
  The `Agent` API (`streamFn` / `initialState` / `getApiKey` / `onPayload` /
  `subscribe` / `prompt` / `state`) is unchanged.
- **Credentials**: JSON stores `apiKeyEnv` (env var name), never the key. Backend
  resolves `process.env[binding.apiKeyEnv]` at call time.
- **Do not run pi in the browser** — it is Node-only (`fs` / `process` / HTTP;
  CORS + key exposure). The frontend never imports pi; it only calls the Hono
  backend.
- **`.env` is gitignored**; `.env.example` is the committed template. `cp` it
  before running.
- **pnpm only** (not npm/yarn). `packageManager: pnpm@11.13.0`. Build-script
  allowlist lives in `pnpm-workspace.yaml` (`onlyBuiltDependencies`), NOT in
  `package.json`'s `pnpm` field (pnpm 11 ignores that field).

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

- `src/nodes/llm/index.ts` — LLM node registry; `onAdd()` sets `apiHost` default.
- `server/index.mjs` — Hono app; `POST /chat/completions` + CORS + `/health/live`.
- `server/pi-runtime-adapter.mjs` — pi wrapper (`runPiAgent`, `ProviderRuntimeError`).
- `config/provider-bindings.json` — active provider binding (fake-default).
- `config/provider-bindings.example.json` — real-provider template (create as needed).
- `scripts/fake-provider.mjs` — OpenAI-compatible fake (port 4010, SSE + test control).
- `.env.example` — `FAKE_PROVIDER_API_KEY` / `SERVER_PORT` / `FAKE_PROVIDER_PORT` / `PROVIDER_BINDINGS_FILE`.
- `rsbuild.config.ts` — Rsbuild config.
- `pnpm-workspace.yaml` — `onlyBuiltDependencies`.

## Wayfinder tracker operations

This repo uses GitHub Issues as the wayfinder tracker (map issue + child
tickets). The map is #17. Two gotchas when creating/linking tickets:

**Sub-issues API requires `X-GitHub-Api-Version: 2026-03-10` + database ID
(not issue number).** `gh api` defaults to API version `2022-11-28`, which
returns 404. And `-f` sends strings, but `sub_issue_id` must be an integer.

```bash
# 1. Get the database ID for a child issue (e.g. #22)
child_id=$(gh api repos/zubingtan/workflow/issues/22 --jq '.id')

# 2. Link it as a sub-issue of the map (#17)
echo "{\"sub_issue_id\": $child_id}" | gh api \
  repos/zubingtan/workflow/issues/17/sub_issues \
  --input - \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  -H "Accept: application/vnd.github+json"

# 3. Verify
gh api repos/zubingtan/workflow/issues/17/sub_issues \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  --jq '.[] | "#\(.number) \(.title) [\(.state)]"'
```

**Ticket creation checklist** (run in this order):

1. `gh issue create` with `--label "wayfinder:<type>"` (`research` / `grilling`
   / `task`) and `## Blocked by` section in body listing parent issue numbers.
2. Fetch each new issue's database ID: `gh api repos/zubingtan/workflow/issues/<N> --jq '.id'`.
3. Link as sub-issue of the map (#17) using the API call above.
4. Update the map's `## Open tickets (frontier)` section with title + link +
   blocking status.
5. Claim a ticket by `gh issue edit <N> --add-assignee zubingtan` before
   starting work.

**Blocking relationships** use body convention (`## Blocked by: #NN`) since
GitHub has no native issue blocking. The sub-issue relationship (parent → child)
is for map hierarchy, not blocking — a sub-issue can be unblocked while another
sub-issue of the same map is blocked.

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
