#!/usr/bin/env bash
# Remove a worktree and delete its branch after PR merge.
# Usage: scripts/remove-worktree.sh <name>
#   <name> the kebab-case worktree name (e.g. merge-base-check)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <name>"
  echo "  <name> kebab-case worktree identifier (e.g. merge-base-check)"
  exit 1
fi

NAME="$1"
WORKTREE_DIR=".worktrees/${NAME}"

if [ ! -d "$WORKTREE_DIR" ]; then
  echo "Error: worktree directory '$WORKTREE_DIR' does not exist."
  exit 1
fi

# Detect the branch checked out in the worktree
BRANCH="$(git -C "$WORKTREE_DIR" branch --show-current)"

echo "→ Removing worktree: $WORKTREE_DIR"
git worktree remove "$WORKTREE_DIR"

if [ -n "$BRANCH" ]; then
  echo "→ Deleting branch: $BRANCH"
  git branch -D "$BRANCH"
fi

echo ""
echo "✓ Cleaned up worktree '$NAME' and branch '$BRANCH'."
