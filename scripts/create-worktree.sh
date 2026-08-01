#!/usr/bin/env bash
# Create a git worktree branched from the latest remote main.
# Usage: scripts/create-worktree.sh <type> <name>
#   <type> ∈ feat | fix | chore | research | docs
#   <name> kebab-case short identifier
#
# Example:
#   scripts/create-worktree.sh chore merge-base-check
#   → fetches origin, creates .worktrees/merge-base-check on branch chore/merge-base-check

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ $# -ne 2 ]; then
  echo "Usage: $0 <type> <name>"
  echo "  <type> ∈ feat | fix | chore | research | docs"
  echo "  <name> kebab-case short identifier"
  exit 1
fi

TYPE="$1"
NAME="$2"

case "$TYPE" in
  feat|fix|chore|research|docs) ;;
  *)
    echo "Error: invalid type '$TYPE'. Must be one of: feat fix chore research docs"
    exit 1
    ;;
esac

BRANCH="${TYPE}/${NAME}"
WORKTREE_DIR=".worktrees/${NAME}"

if [ -d "$WORKTREE_DIR" ]; then
  echo "Error: worktree directory '$WORKTREE_DIR' already exists."
  exit 1
fi

echo "→ Fetching latest from origin..."
git fetch origin

echo "→ Creating worktree: $WORKTREE_DIR (branch: $BRANCH, base: origin/main)"
git worktree add -b "$BRANCH" "$WORKTREE_DIR" origin/main

echo ""
echo "✓ Ready. Work in: $WORKTREE_DIR"
echo "  cd $WORKTREE_DIR"
