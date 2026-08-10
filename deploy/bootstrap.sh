#!/usr/bin/env bash
# #293: one-time server bootstrap — idempotent, safe to re-run.
#
# 1. Toolchain: nvm Node 22 + corepack pnpm
# 2. Repo: clone/pull <WF_DIR> (main)
# 3. Old stack: stop the legacy dev trio (3000/4010) — #293/#295
# 4. nginx: wire deploy/nginx/workflow-location.conf into the server block
#    that serves <host> (conf.d fragment; conflicts detected, not auto-fixed)
# 5. supervisord: install workflow + fake-provider programs
#
# Generic by default; environment-specific bits are overridable env vars
# (see Config block). Run: bash deploy/bootstrap.sh (sudo must be available)
set -euo pipefail

# --- Config (override via env) ---
WF_USER="${WF_USER:-$(whoami)}"
WF_HOME="${WF_HOME:-$HOME}"
WF_DIR="${WF_DIR:-$WF_HOME/projects/workflow}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
NGINX_MAIN="${NGINX_MAIN:-/etc/nginx/nginx.conf}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/conf.d/workflow.conf}"
# Optional source of a standalone legacy config (full events/http layout) to
# convert into the conf.d fragment; ignored when empty or missing.
NGINX_SRC="${NGINX_SRC:-}"
# server_name of the server block that should host the /workflow location;
# empty = first server block in the fragment.
SERVER_NAME="${SERVER_NAME:-}"
SUPERVISOR_DIR="${SUPERVISOR_DIR:-/etc/supervisor/conf.d}"
BASE_PATH="${BASE_PATH:-/workflow}"
PORT="${PORT:-4000}"
FAKE_PROVIDER_PORT="${FAKE_PROVIDER_PORT:-4010}"
WORKFLOW_LOCATION="$WF_DIR/deploy/nginx/workflow-location.conf"

say() { printf '\n==> %s\n' "$*"; }

# --- 1. Toolchain ---
say "1/5 toolchain: Node 22 via nvm + pnpm via corepack"
if [ ! -x "$NODE_BIN" ]; then
  say "node missing — install Node 22 first (e.g. nvm install 22), or set NODE_BIN"
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
corepack enable pnpm >/dev/null 2>&1 || true
node --version

# --- 2. Repo ---
say "2/5 repo at $WF_DIR (main)"
mkdir -p "$(dirname "$WF_DIR")"
if [ ! -d "$WF_DIR/.git" ]; then
  git clone https://github.com/zubingtan/workflow.git "$WF_DIR"
else
  git -C "$WF_DIR" fetch origin
  git -C "$WF_DIR" checkout main
  git -C "$WF_DIR" reset --hard origin/main
fi
cd "$WF_DIR"
pnpm install --frozen-lockfile

# --- 3. Old stack teardown (legacy dev trio, #293/#295) ---
# Only kill node processes that look like the legacy dev stack, so re-runs of
# this script never touch unrelated listeners (incl. the supervisord-managed
# fake-provider once this script has been run before).
say "3/5 stop legacy dev stack (3000 old workflow backend / 4010 old fake-provider)"
for port in 3000 4010; do
  pids="$(ss -ltnp 2>/dev/null | grep ":$port " | grep -oP '(?<=pid=)\d+' | sort -u || true)"
  for pid in $pids; do
    cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    case "$cmdline" in
      *node*"server/index.mjs"*|*node*"fake-provider.mjs"*)
        say "killing legacy pid $pid (:$port): $cmdline"
        kill "$pid" 2>/dev/null || sudo kill "$pid" 2>/dev/null || true
        ;;
      *)
        say "SKIP :$port pid $pid — not a legacy workflow process: $cmdline"
        ;;
    esac
  done
done

# --- 4. nginx: wire the workflow location into the site fragment ---
# Generic flow:
#   - NGINX_SITE missing + NGINX_SRC set: convert the standalone legacy config
#     into a conf.d fragment (http-context only, legacy listeners dropped).
#   - NGINX_SITE existing: check server_name collisions against other conf.d
#     files (nginx silently ignores the later duplicate — fail loudly instead).
#   - Insert `include <workflow-location.conf>;` into the target server block
#     (idempotent). All writes go through sudo (conf.d is root-owned).
say "4/5 nginx: wire $WORKFLOW_LOCATION into $NGINX_SITE"
sudo mkdir -p "$(dirname "$NGINX_SITE")"
if [ ! -f "$NGINX_SITE" ] && [ -n "$NGINX_SRC" ] && [ -f "$NGINX_SRC" ]; then
  say "converting standalone config $NGINX_SRC -> $NGINX_SITE"
  sudo "$NODE_BIN" "$WF_DIR/deploy/scripts/nginx-wiring.mjs" "$NGINX_SRC" "$NGINX_SITE" "$WORKFLOW_LOCATION" ${SERVER_NAME:+--server-name "$SERVER_NAME"}
fi
if [ ! -f "$NGINX_SITE" ]; then
  say "ERROR: no nginx site fragment at $NGINX_SITE and no NGINX_SRC to convert."
  say "  Point NGINX_SRC at an existing standalone nginx config, or create"
  say "  $NGINX_SITE with a server block for your host first."
  exit 1
fi

say "checking server_name collisions in $(dirname "$NGINX_SITE")"
sudo "$NODE_BIN" "$WF_DIR/deploy/scripts/nginx-wiring.mjs" --check-conflicts "$(dirname "$NGINX_SITE")" "$NGINX_SITE" \
  || { say "ERROR: disable the conflicting conf.d file(s) above, then re-run bootstrap"; exit 1; }

if grep -q "workflow-location.conf" "$NGINX_SITE"; then
  say "workflow include already present in $NGINX_SITE"
else
  say "inserting workflow include into $NGINX_SITE"
  sudo "$NODE_BIN" "$WF_DIR/deploy/scripts/nginx-wiring.mjs" "$NGINX_SITE" "$NGINX_SITE" "$WORKFLOW_LOCATION" ${SERVER_NAME:+--server-name "$SERVER_NAME"}
fi

say "validating $NGINX_MAIN"
if ! sudo nginx -t -c "$NGINX_MAIN"; then
  say "nginx config invalid — inspect $NGINX_SITE manually; bootstrap aborted"
  exit 1
fi
if pgrep -f 'nginx: master process.*workflow-nginx' >/dev/null; then
  say "legacy nginx master (-c /tmp config) detected — restarting against $NGINX_MAIN"
  sudo pkill -f 'nginx: master process.*workflow-nginx' || true
  sleep 1
  sudo nginx -c "$NGINX_MAIN"
else
  sudo nginx -c "$NGINX_MAIN" -s reload || say "WARN: reload failed (legacy master? run: sudo nginx -c $NGINX_MAIN)"
fi

# --- 5. supervisord ---
say "5/5 supervisord: install workflow + fake-provider programs"
sudo mkdir -p "$SUPERVISOR_DIR"
mkdir -p "$WF_HOME/.config/workflow/logs"   # supervisord logfile targets (workflow.conf)
sed -e "s|/home/zubingtan|$WF_HOME|g" deploy/supervisord/workflow.conf | sudo tee "$SUPERVISOR_DIR/workflow.conf" > /dev/null
supervisorctl reread || sudo supervisorctl reread
supervisorctl update || sudo supervisorctl update

say "bootstrap done. Next steps:"
say "  1. UI: fill Feishu App ID/Secret on the trigger + bot nodes (#298), pick the LLM agent"
say "  2. Import template: node deploy/import-template.mjs --base http://localhost:$PORT/workflow"
say "  3. Verify: bash deploy/verify/verify-feishu-echo.sh (local machine)"
