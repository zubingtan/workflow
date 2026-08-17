---
name: simplify
description: Review changed code for reuse, quality, and efficiency, then fix any issues found. Use when the user asks to simplify, clean up, or polish recently changed code, or mentions reuse/quality/efficiency review of a diff.
---

# Simplify: Code Review and Cleanup

Review all changed files for reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run `git diff` (or `git diff HEAD` if there are staged changes) to see what changed.
If there are no git changes, review the most recently modified files that the user
mentioned or that you edited earlier in this conversation.

## Phase 2: Launch Three Review Agents in Parallel

Use the Agent tool to launch all three agents concurrently in a single
message. Pass each agent the full diff so it has the complete context.

### Agent 1: Code Reuse Review

- Search for existing utilities/helpers that could replace newly written code
- Flag new functions that duplicate existing functionality
- Flag inline logic that could use existing utilities

### Agent 2: Code Quality Review

- Redundant state, parameter sprawl, copy-paste with slight variation
- Leaky abstractions, stringly-typed code
- Unnecessary comments (keep only non-obvious WHY)

### Agent 3: Efficiency Review

- Unnecessary work: redundant computations, repeated file reads, N+1 patterns
- Missed concurrency: independent operations run sequentially
- Hot-path bloat, memory leaks, overly broad operations

## Phase 3: Fix Issues

Wait for all three agents to complete. Aggregate findings and fix each issue directly.
If a finding is a false positive, note it and move on.

When done, briefly summarize what was fixed (or confirm the code was already clean).
