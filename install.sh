#!/usr/bin/env bash
# One-click installer for workflow (Hono + SPA) — clone → ./install.sh → done.
#
#   ./install.sh                          # interactive (asks what it needs)
#   ./install.sh --yes                    # all defaults, no prompts
#   ./install.sh --host app.example.com --port 4000 --data-dir ~/.config/workflow
#
# What it does:
#   1. checks the toolchain (Node 22, pnpm, nginx, a process manager)
#   2. pnpm install + production build (BASE_PATH)
#   3. registers the app with supervisord, or systemd, or nohup (in that order)
#   4. wires nginx: generates a server block for your host, conflict-checks,
#      validates and reloads
#   5. imports the Feishu echo workflow template
#   6. prints next steps (credentials + verification)
#
# Options:
#   --host <domain|ip>   nginx server_name (interactive prompt if omitted)
#   --port <n>           workflow port            (default 4000)
#   --base-path <path>   sub-path mount           (default /workflow)
#   --data-dir <path>    data directory           (default ~/.config/workflow)
#   --yes                non-interactive: defaults for everything
#   --skip-nginx         do not touch nginx
#   --skip-process       do not register a process manager (manual start)
#   --help               this message
set -euo pipefail

# --- colors / helpers -------------------------------------------------------
C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
say()   { printf '%s\n' "$*"; }
info()  { printf '%s[install]%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()  { printf '%s[install]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
die()   { printf '%s[install]%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }
need()  { command -v "$1" >/dev/null 2>&1; }

# --- defaults / args --------------------------------------------------------
PORT=4000
BASE_PATH=/workflow
DATA_DIR="${DATA_DIR:-$HOME/.config/workflow}"
HOST=""
YES=0
SKIP_NGINX=0
SKIP_PROCESS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    --port) PORT="${2:-4000}"; shift 2 ;;
    --base-path) BASE_PATH="${2:-/workflow}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    --skip-process) SKIP_PROCESS=1; shift ;;
    --help|-h) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1 (see ./install.sh --help)" ;;
  esac
done

WF_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

# --- interactive prompts ----------------------------------------------------
ask() { # ask <var> <prompt> <default>
  local var="$1" prompt="$2" default="${3:-}" answer
  if [ "$YES" -eq 1 ]; then eval "$var=\"$default\""; return; fi
  printf '%s [%s]: ' "$prompt" "${default:-none}"
  read -r answer
  eval "$var=\"${answer:-$default}\""
}

if [ -z "$HOST" ]; then
  if [ "$YES" -eq 1 ]; then
    HOST="$(hostname -I 2>/dev/null | awk '{print $1}')" || true
    [ -n "$HOST" ] || die "--yes requires --host (or a resolvable hostname -I)"
  else
    ask HOST "server domain or IP that nginx will serve (e.g. workflow.example.com)" ""
  fi
fi
if [ "$SKIP_NGINX" -eq 0 ] && [ -z "$HOST" ]; then
  die "no --host given and nginx wiring requested (use --skip-nginx to skip nginx)"
fi
if [ "$SKIP_PROCESS" -eq 0 ]; then
  ask DATA_DIR "data directory" "$DATA_DIR"
fi
DATA_DIR="${DATA_DIR/#\~/$HOME}"

# --- 1. toolchain -----------------------------------------------------------
info "checking toolchain"
if [ -z "$NODE_BIN" ] || ! "$NODE_BIN" --version >/dev/null 2>&1; then
  die "Node.js not found — install Node 22 first (nvm: \`nvm install 22\`), or set NODE_BIN"
fi
NODE_MAJOR="$("$NODE_BIN" --version | sed 's/^v\([0-9]*\).*/\1/')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node $("$NODE_BIN" --version) detected — workflow requires Node 22 (better-sqlite3 binding)"
say "  node: $("$NODE_BIN" --version)"
export PATH="$(dirname "$NODE_BIN"):$PATH"
if ! need pnpm; then
  info "pnpm missing — enabling via corepack"
  corepack enable pnpm >/dev/null 2>&1 || die "corepack failed — install pnpm manually (corepack enable pnpm)"
fi
say "  pnpm: $(pnpm --version)"

if [ "$SKIP_NGINX" -eq 0 ]; then
  need nginx || die "nginx not found — install nginx first (apt install nginx), or use --skip-nginx"
  say "  nginx: $(nginx -v 2>&1 | awk '{print $3}')"
fi

PROC_MGR="none"
if [ "$SKIP_PROCESS" -eq 0 ]; then
  if need supervisorctl; then PROC_MGR=supervisord
  elif need systemctl && systemctl --version >/dev/null 2>&1; then PROC_MGR=systemd
  else warn "neither supervisord nor systemd found — will start with nohup (no auto-restart)"; fi
  say "  process manager: $PROC_MGR"
fi

# --- 2. install + build -----------------------------------------------------
info "installing dependencies (pnpm install --frozen-lockfile)"
pnpm install --frozen-lockfile

info "building (BASE_PATH=$BASE_PATH)"
BASE_PATH="$BASE_PATH" pnpm build

# --- 3. process manager -----------------------------------------------------
mkdir -p "$DATA_DIR/logs"
render() { # render <template> — replace {{PLACEHOLDERS}}
  sed -e "s|{{WF_DIR}}|$WF_DIR|g" \
      -e "s|{{NODE_BIN}}|$NODE_BIN|g" \
      -e "s|{{PORT}}|$PORT|g" \
      -e "s|{{BASE_PATH}}|$BASE_PATH|g" \
      -e "s|{{DATA_DIR}}|$DATA_DIR|g" \
      -e "s|{{FAKE_PROVIDER_PORT}}|${FAKE_PROVIDER_PORT:-4010}|g" \
      "$1"
}

case "$PROC_MGR" in
  supervisord)
    info "registering with supervisord"
    render deploy/supervisord/workflow.conf | sudo tee /etc/supervisor/conf.d/workflow.conf > /dev/null
    sudo supervisorctl reread >/dev/null
    sudo supervisorctl update
    sudo supervisorctl restart workflow fake-provider
    ;;
  systemd)
    info "registering with systemd"
    render deploy/systemd/workflow.service.example | sudo tee /etc/systemd/system/workflow.service > /dev/null
    sudo systemctl daemon-reload
    sudo systemctl enable --now workflow
    sudo systemctl restart workflow
    ;;
  none)
    info "starting with nohup (no auto-restart)"
    (nohup "$NODE_BIN" scripts/fake-provider.mjs >> "$DATA_DIR/logs/fake-provider.out.log" 2>&1 &) || true
    (FAKE_PROVIDER_PORT="${FAKE_PROVIDER_PORT:-4010}" nohup env NODE_ENV=production PORT="$PORT" BASE_PATH="$BASE_PATH" WORKFLOW_DATA_DIR="$DATA_DIR" \
      "$NODE_BIN" server/index.mjs >> "$DATA_DIR/logs/workflow.out.log" 2>&1 &)
    warn "processes started via nohup — they will NOT auto-restart on reboot/crash"
    ;;
esac

# --- 4. nginx ---------------------------------------------------------------
if [ "$SKIP_NGINX" -eq 0 ]; then
  NGINX_SITE="${NGINX_SITE:-/etc/nginx/conf.d/workflow.conf}"
  WIRING="$WF_DIR/deploy/scripts/nginx-wiring.mjs"
  info "wiring nginx ($NGINX_SITE, server_name $HOST)"

  if [ -f "$NGINX_SITE" ]; then
    sudo "$NODE_BIN" "$WIRING" --check-conflicts "$(dirname "$NGINX_SITE")" "$NGINX_SITE" \
      || die "server_name conflict in $(dirname "$NGINX_SITE") — disable the conflicting file and re-run"
    if grep -q "location /$BASE_PATH" "$NGINX_SITE" || grep -q "workflow-location.conf" "$NGINX_SITE"; then
      info "workflow location already present in $NGINX_SITE"
    else
      warn "$NGINX_SITE exists without a workflow location — add manually:"
      warn "  include $WF_DIR/deploy/nginx/workflow-location.conf;  (inside your server block)"
    fi
  else
    info "generating server block for $HOST"
    sed -e "s|{{HOST}}|$HOST|g" -e "s|{{PORT}}|$PORT|g" deploy/nginx/workflow-server.conf.example | sudo tee "$NGINX_SITE" > /dev/null
    sudo "$NODE_BIN" "$WIRING" --check-conflicts "$(dirname "$NGINX_SITE")" "$NGINX_SITE" \
      || die "server_name conflict in $(dirname "$NGINX_SITE") — disable the conflicting file and re-run"
  fi

  info "validating + reloading nginx"
  sudo nginx -t
  if need systemctl && systemctl is-active nginx >/dev/null 2>&1; then
    sudo systemctl reload nginx
  else
    sudo nginx -s reload || warn "nginx reload failed — run: sudo systemctl reload nginx"
  fi
fi

# --- 5. import template -----------------------------------------------------
info "importing Feishu echo workflow template"
"$NODE_BIN" deploy/import-template.mjs --base "http://localhost:${PORT}${BASE_PATH}"

# --- 6. health check + summary ---------------------------------------------
sleep 2
if curl -fsS "http://127.0.0.1:${PORT}${BASE_PATH}/health/live" >/dev/null 2>&1; then
  say ""
  say "${C_BOLD}${C_GREEN}✓ workflow is up: http://${HOST}${BASE_PATH}${C_RESET}"
else
  warn "health check failed — check logs: $DATA_DIR/logs/workflow.err.log"
fi
say ""
say "${C_BOLD}Next steps${C_RESET}"
say "  1. Open the dashboard and fill credentials (3 places, same Feishu app):"
say "     - Feishu Trigger node: App ID / App Secret"
say "     - Feishu Bot node:     App ID / App Secret"
say "     - LLM node:            pick the fake-provider agent (http://127.0.0.1:${FAKE_PROVIDER_PORT:-4010}/v1)"
say "  2. Verify the loop from your local machine (feishu-im login required):"
say "     ssh -L ${FAKE_PROVIDER_PORT:-4010}:127.0.0.1:${FAKE_PROVIDER_PORT:-4010} <server>"
say "     CHAT_ID=<chat-id> BOT_OPEN_ID=<bot-open-id> bash deploy/verify/verify-feishu-echo.sh"
say "  Full details: deploy/README.md"
