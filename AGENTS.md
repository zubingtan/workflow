# Repository Agent Instructions

These instructions apply to the entire repository. When a task is unclear or conflicts with an approved contract, stop and surface the ambiguity before changing files.

## 1. Think Before Coding

Do not assume or hide confusion. Before implementation:

- State assumptions explicitly.
- Present materially different interpretations instead of choosing silently.
- Point out a simpler approach or a meaningful tradeoff when one exists.
- Stop and ask when missing information would materially change the result.

## 2. Simplicity First

Write the minimum code needed for the requested behavior.

- Do not add speculative features, unused abstractions, or unrequested configurability.
- Do not handle impossible scenarios.
- If the solution is substantially larger than necessary, simplify it.

## 3. Surgical Changes

Touch only lines that trace directly to the task.

- Do not refactor, reformat, or clean adjacent code.
- Match the existing style.
- Remove imports, variables, and functions made unused by your own change only.
- Mention unrelated dead code; do not delete it unless asked.

## 4. Goal-Driven Execution

Turn each task into verifiable goals and loop until they pass. For multi-step work, state a brief plan in this form:

```text
1. [step] -> verify: [check]
2. [step] -> verify: [check]
3. [step] -> verify: [check]
```

For behavior changes, write a deterministic failing test first, then the minimum implementation that makes it pass. Do not weaken test intent during GREEN.

## 5. Main-Agent Orchestration

The main agent is orchestration-only: it reads requirements, decomposes work, delegates bounded tasks, resolves conflicts, waits for results, and decides the next step. The main agent must not edit or write product code or tests, run acceptance, or perform Git and GitHub release operations.

- At most one write-capable subagent may work at a time. Read-only scouts and reviewers may run concurrently within `.codex/config.toml` limits.
- Child agents must not spawn further child agents; `agents.max_depth = 1` enforces direct-child delegation.
- Each subagent stays within the ownership defined in its `.codex/agents/*.toml` file.

## 6. TDD and Sequential PRs

For each functional PR:

1. `test-author` writes and records deterministic failing tests.
2. The owning implementation agent makes those tests pass without changing their intent.
3. `verifier-reviewer` independently runs focused and full checks and reviews scope.
4. `release-manager` updates requirement-to-test-to-evidence traceability and manages the PR.
5. Merge only after required checks pass; base the next PR on the latest `main`.

Do not mask a defect by rerunning CI. Fix merged defects through a new PR.

## 7. Current Documentation with Context7

Use the `ctx7` CLI whenever a task asks about library, framework, SDK, API, CLI, or cloud-service documentation, including configuration, setup, migration, and version-specific behavior. Do not use it for business-logic debugging, code review, general programming concepts, or scripts written from first principles.

1. Resolve the library first: `npx ctx7@latest library <name> "<full question>"`.
2. Select the exact official match with the strongest relevance, reputation, snippets, and benchmark score.
3. Fetch the answer: `npx ctx7@latest docs <libraryId> "<full question>"`.
4. Use a versioned ID when version-specific documentation is required.

Run no more than three Context7 commands per question and never include secrets. If the CLI reports quota exhaustion, report it and suggest `npx ctx7@latest login` or `CONTEXT7_API_KEY`. If it fails from DNS or network isolation, rerun it outside the sandbox rather than falling back silently.
