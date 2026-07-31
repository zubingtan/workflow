# @mem0/pi-agent-plugin

Persistent semantic memory for [Pi Agent](https://pi.dev), powered by [Mem0](https://mem0.ai).

This extension gives Pi Agent long-term memory that persists across sessions, projects, and devices. Memories are automatically captured from conversations and can be searched, managed, and consolidated through slash commands and an agent-accessible tool.

## Features

- **Automatic memory capture** — learns from every conversation (both user and assistant messages)
- **Semantic search** — find memories by meaning, not just keywords
- **Scoped memory** — project, session, or global scope
- **Monorepo-aware** — uses git root for project detection, consistent app_id across subdirectories
- **Dream consolidation** — merges duplicates, resolves contradictions, prunes stale entries
- **Confirmation dialogs** — destructive commands ask before acting
- **8 slash commands** — essential memory management from the command line
- **Agent tool** — `mem0_memory` tool lets the agent search and store memories autonomously

## Setup

### 1. Get an API key

Sign up at [app.mem0.ai](https://app.mem0.ai/dashboard/api-keys) and copy your API key.

### 2. Install

```bash
pi install npm:@mem0/pi-agent-plugin
```

### 3. Configure

Set the API key as an environment variable:

```bash
export MEM0_API_KEY="m0-your-key-here"
```

Or create a config file at `~/.pi/agent/mem0-config.json`:

```json
{
  "apiKey": "m0-your-key-here",
  "userId": "your-username",
  "autoCapture": true,
  "defaultScope": "project",
  "searchThreshold": 0.2,
  "dream": {
    "enabled": true,
    "auto": true,
    "minHours": 24,
    "minSessions": 5,
    "minMemories": 20
  }
}
```

Environment variables (`MEM0_API_KEY`, `MEM0_USER_ID`) override the config file.

`searchThreshold` (default `0.3`) is the minimum similarity score (0–1) a memory must reach to count as a match for `/mem0-search`, `/mem0-forget`, and `/mem0-pin`. It is passed to the mem0 search API (along with reranking for higher-precision ordering), so a query with no sufficiently similar memory reports no match instead of returning the closest unrelated memories. Raise it to be stricter; lower it if relevant results are missed.

## Commands

| Command                 | Description                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `/mem0-remember <text>` | Store a memory verbatim (no inference)                              |
| `/mem0-forget <query>`  | Search and delete memories (with confirmation)                      |
| `/mem0-search <query>`  | Semantic search across memories                                     |
| `/mem0-tour [scope]`    | Browse all memories grouped by category                             |
| `/mem0-dream`           | Consolidate — merge duplicates, prune stale, resolve contradictions |
| `/mem0-pin <query>`     | Pin a memory to protect from dream pruning (preserves ID)           |
| `/mem0-scope <scope>`   | Change default scope for this session                               |
| `/mem0-status`          | Connection health, identity, and memory count                       |

## Skills

The plugin includes 8 skills that guide the agent on how to use each capability:

| Skill            | Purpose                                      |
| ---------------- | -------------------------------------------- |
| `context-loader` | Pre-fetch relevant memories at session start |
| `remember`       | Store facts with category classification     |
| `search`         | Quick semantic search with compact results   |
| `forget`         | Delete memories with confirmation            |
| `dream`          | Memory consolidation workflow                |
| `tour`           | Full memory walkthrough by category          |
| `pin`            | Protect critical memories from pruning       |
| `status`         | Health check and diagnostics                 |

## Memory Scopes

| Scope     | Filters                  | Use case                              |
| --------- | ------------------------ | ------------------------------------- |
| `project` | user + app_id (git root) | Default. Project-specific knowledge   |
| `session` | user + app_id + run_id   | Ephemeral, session-only context       |
| `global`  | user only                | All memories across all your projects |

Project scoping uses `git rev-parse --show-toplevel` to detect the repository root, so all subdirectories within a monorepo share the same memory pool.

## Memory Categories

Memories are automatically classified into 10 general-purpose categories:

| Category        | Description                                     |
| --------------- | ----------------------------------------------- |
| `identity`      | Personal details, background, self-descriptions |
| `preferences`   | Likes, dislikes, habits, preferred approaches   |
| `goals`         | Objectives, aspirations, targets                |
| `projects`      | Ongoing work, initiatives, areas of focus       |
| `decisions`     | Choices made, rationale, trade-offs             |
| `technical`     | Technical knowledge, tools, configurations      |
| `relationships` | People, teams, organizations                    |
| `routines`      | Recurring patterns, workflows, schedules        |
| `lessons`       | Insights learned, mistakes to avoid             |
| `work`          | Professional context, role, responsibilities    |

## Architecture

```
pi-agent-plugin/
├── src/
│   ├── entry.ts          # Extension entry point
│   ├── index.ts          # Barrel exports
│   ├── commands.ts       # 8 slash commands
│   ├── prompt.ts         # System prompt injection (MEMORY_POLICY)
│   ├── types.ts          # Shared interfaces and categories
│   ├── telemetry.ts      # PostHog telemetry (batched, PII-safe)
│   ├── config/           # Config loading (~/.pi/agent/mem0-config.json)
│   ├── memory/           # Tool registration, scoping (git root), formatting
│   ├── capture/          # Auto-capture from conversations (user + assistant)
│   └── dream/            # Consolidation state, gating, locking, prompts
├── skills/               # 8 SKILL.md files for Pi Agent
├── tests/                # Vitest unit tests
└── dist/                 # Built output (ESM + DTS)
```

## Development

```bash
pnpm install          # Install dependencies
pnpm run typecheck    # Type check
pnpm run test         # Run tests
pnpm run build        # Build (ESM + declarations)
```

## License

[Apache-2.0](LICENSE)

---

## Fork: self-hosted adaptation (FlowGram, spec #212)

This is a fork of upstream `@mem0/pi-agent-plugin` v0.1.3 adapted for a
**self-hosted** mem0 server (no cloud account, data stays local).

Key differences from upstream (see the spec's decision log for the full
rationale):

- **`SelfHostedMemoryClient`** (`src/client.ts`) replaces the cloud SDK:
  no `/v1/` path prefix, `X-API-Key` auth, `GET /memories` for `getAll`,
  snake_case wire format with snake→camel response conversion.
- **Config** (`src/config/index.ts`): loaded from `MEM0_CONFIG_PATH`, or
  `{agentDir}/mem0-config.json` (reloaded on `session_start`), falling back
  to the upstream `~/.pi/agent/mem0-config.json`. The workflow backend
  writes the per-run config before every run.
- **Scopes** (`src/memory/scoping.ts`): `project/session/global` →
  `agent/session`. `agent_id` is the isolation dimension; `run_id` is
  provenance on add. `user_id`/`app_id` are never sent.
- **Auto-capture** always tags `agent_id` + `run_id` (D3).
- **Dream consolidation** defaults to **disabled** (D9).
- **Telemetry defaults OFF** (D11) — upstream defaulted ON; set
  `MEM0_TELEMETRY=true` to opt back in.
- Cloud-only params (`customCategories`, `rerank`, `output_format`) are
  never sent (D5).

Loading: pi's `DefaultResourceLoader` discovers the extension at
`{agentDir}/extensions/pi-extension-mem0/` (dist built by `pnpm build`,
shipped to `/opt/pi-extension-mem0` in Docker, D15).
