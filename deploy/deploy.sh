#!/usr/bin/env bash
# #293: deploy/update a running w8 instance to the latest main.
#
#   pull → install → build (BASE_PATH=/workflow) → supervisorctl restart
#
# Run on w8: bash deploy/deploy.sh   (idempotent, no downtime beyond restart)
set -euo pipefail

WF_HOME="${WF_HOME:-/home/zubingtan}"
WF_DIR="${WF_DIR:-$WF_HOME/projects/workflow}"
NODE_BIN="${NODE_BIN:-$WF_HOME/.nvm/versions/node/v22.23.1/bin/node}"
BASE_PATH="${BASE_PATH:-/workflow}"

say() { printf '\n==> %s\n' "$*"; }

cd "$WF_DIR"
say "fetch + reset to origin/main"
git fetch origin
git checkout main
git reset --hard origin/main

export PATH="$(dirname "$NODE_BIN"):$PATH"
say "install deps"
pnpm install --frozen-lockfile

say "build (BASE_PATH=$BASE_PATH)"
BASE_PATH="$BASE_PATH" pnpm build

say "restart supervisord programs"
supervisorctl restart workflow fake-provider || sudo supervisorctl restart workflow fake-provider

say "health checks"
# BASE_PATH=/workflow means the app only answers under /workflow (root 404, #297).
curl -fsS "http://127.0.0.1:4000/workflow/health/live" && echo " workflow OK"
curl -fsS "http://127.0.0.1:4010/health/live" && echo " fake-provider OK"
