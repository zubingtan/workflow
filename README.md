# Workflow editor

This repository contains the minimal read/write workflow editor for the
`workflow/v1alpha1` contract. A workflow is a versioned JSON document with a
visual editor and a JSON authoring view.

The editor supports exactly four node types:

```text
input.prompt -> task.agent -> output.markdown
```

`logic.condition` may route a run into branches; its selected branch can lead
to an Agent or directly to Markdown output.

## Local development

Fresh checkout preparation installs dependencies and builds the application
image, so it may exceed 30 seconds:

```bash
pnpm doctor
pnpm setup
```

After setup, this is the only warm daily startup command. It uses the
checked-in Fake Provider configuration, does not rebuild, and applies one
30-second deadline to Compose startup and the final readiness request:

```bash
pnpm dev
```

Open <http://127.0.0.1:3000>. Readiness is
<http://127.0.0.1:3000/api/health/ready>. `pnpm dev` prints the exact URL when
the stack is ready. Use `pnpm logs` to follow services and `pnpm down` to stop
them. Run `pnpm dev:build` only after application or dependency changes require
a new image; rebuilding may exceed 30 seconds.

The default path reads `.env.example` and
`config/provider-bindings.fake.json`; it never reads `.env` or `.env.local`.
For a real OpenAI-compatible provider, copy the non-secret binding template and
create the ignored credential override:

```bash
cp config/provider-bindings.example.json config/provider-bindings.local.json
printf 'REAL_PROVIDER_API_KEY=replace-me\n' > .env.local
pnpm dev:real
```

Edit the local JSON with the provider base URL and model. Keep
`apiKeyEnv: "REAL_PROVIDER_API_KEY"`; never put credentials in JSON. Real mode
loads `.env.example` first and `.env.local` second, then mounts the local JSON
read-only. Both local files are git-ignored. `pnpm dev:real` validates them
without printing credential values.

The UI lists workflows, creates and versions
definitions, edits the visual graph or JSON, and starts a read-only test run.
The repository has one PR Gate: typecheck → focused unit contracts → one
Playwright E2E. The E2E covers the editor-to-run path on the normal Compose
stack, including PostgreSQL, the Fake Provider, and Chromium; these are part
of the ordinary PR Gate.

## Definition shape

Every definition has `apiVersion: "workflow/v1alpha1"`, `kind: "Workflow"`,
metadata, nodes, and edges. Nodes are `input.prompt`, `task.agent`,
`logic.condition`, or `output.markdown`. Edges carry explicit mappings and a
condition edge carries `sourcePort`.

Agent nodes reference immutable Agent, Skill, and MCP versions. Authoring
captures those references as a snapshot boundary. The Pi adapter receives the
Agent system prompt and Skill snapshot; MCP definitions are metadata only and
are not executed as Pi tools. Provider credentials remain outside definitions.

## Runtime semantics

Runs are evaluated in graph order. A condition evaluates its branches
recursively (AND/OR groups and leaf clauses), selects the first matching
branch, and marks other branch descendants `skipped` with
`not_selected`. A node waits for every incoming dependency before joining;
unavailable or failed inputs prevent downstream execution. Successful nodes
become `selected` for downstream routing and the Markdown node emits the
final result.

See [docs/README.md](docs/README.md) for the compact contract, API summary,
architecture decisions, and requirement-to-test-to-evidence map.
