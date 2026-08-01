#!/usr/bin/env bash
# Rebase the current branch onto latest origin/main and force-push.
# Run from inside a worktree before opening (or updating) a PR.
# Usage: scripts/sync-branch.sh

set -euo pipefail

if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "Error: not inside a git repository."
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [ "$BRANCH" = "main" ]; then
  echo "Error: you're on main. Switch to a feature branch first."
  exit 1
fi

echo "→ Fetching latest from origin..."
git fetch origin

echo "→ Rebasing $BRANCH onto origin/main..."
git rebase origin/main

echo "→ Force-pushing..."
git push --force-with-lease origin HEAD

echo ""
echo "✓ $BRANCH is now built on latest main."
