#!/usr/bin/env bash
# #293: one-time w8 bootstrap — idempotent, safe to re-run.
#
# 1. Toolchain: nvm Node 22 + corepack pnpm
# 2. Repo: clone/pull ~/projects/workflow (main)
# 3. Old stack: stop the legacy dev trio (3000/4010/8888) — #293/#295
# 4. nginx: migrate the live /tmp/workflow-nginx.conf into
#    /etc/nginx/conf.d/zubingtan-w8.conf and serve /workflow from it
#    (the running instance loads /tmp config today, conf.d is dead config)
# 5. supervisord: install workflow + fake-provider programs
#
# Run: bash deploy/bootstrap.sh   (on w8; sudo is passwordless)
set -euo pipefail

# --- Config (override via env) ---
WF_USER="${WF_USER:-zubingtan}"
WF_HOME="${WF_HOME:-/home/$WF_USER}"
WF_DIR="${WF_DIR:-$WF_HOME/projects/workflow}"
NODE_BIN="${NODE_BIN:-$WF_HOME/.nvm/versions/node/v22.23.1/bin/node}"
NGINX_MAIN="${NGINX_MAIN:-/etc/nginx/nginx.conf}"
NGINX_SITE="${NGINX_SITE:-/etc/nginx/conf.d/zubingtan-w8.conf}"
NGINX_OLD="${NGINX_OLD:-/tmp/workflow-nginx.conf}"
SUPERVISOR_DIR="${SUPERVISOR_DIR:-/etc/supervisor/conf.d}"
BASE_PATH="${BASE_PATH:-/workflow}"
PORT="${PORT:-4000}"
FAKE_PROVIDER_PORT="${FAKE_PROVIDER_PORT:-4010}"

say() { printf '\n==> %s\n' "$*"; }

# --- 1. Toolchain ---
say "1/5 toolchain: Node 22 via nvm + pnpm via corepack"
if [ ! -x "$NODE_BIN" ]; then
  say "node $NODE_BIN missing — install via nvm first (nvm install 22)"
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
say "3/5 stop legacy dev stack (3000 old workflow backend / 4010 old fake-provider / 8888 proxy)"
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
# 8888 is served by the same nginx instance; the migration below drops that
# server block, so no separate kill is needed.

# --- 4. nginx migration: /tmp config → conf.d, serve /workflow ---
say "4/5 nginx: migrate $NGINX_OLD into $NGINX_SITE + include workflow location"
mkdir -p /etc/nginx/conf.d
if [ ! -f "$NGINX_SITE" ]; then
  if [ -f "$NGINX_OLD" ]; then
    cp "$NGINX_OLD" "$NGINX_SITE"
    say "copied legacy config to $NGINX_SITE"
  else
    say "WARN: $NGINX_OLD not found — writing an empty site file; add server blocks manually"
    : > "$NGINX_SITE"
  fi
fi
python3 - "$NGINX_SITE" "$WF_DIR/deploy/nginx/workflow-location.conf" <<'PY'
import re, sys
path, loc = sys.argv[1], sys.argv[2]
text = open(path).read()

# 1) Drop server blocks listening on :8888 (legacy workflow proxy, #293).
blocks = re.split(r'(?=^\s*server\s*\{)', text, flags=re.M)
kept = [b for b in blocks if not re.search(r'listen\s+8888', b)]
text = ''.join(kept)

# 2) Insert `include <workflow-location.conf>;` before the closing brace of the
#    zubingtan-w8.corp.pony.ai server block (brace-depth aware, so nested
#    location blocks are not mistaken for the server's closing brace).
inserted = False
if 'workflow-location.conf' not in text:
    m = re.search(r'^\s*server\s*\{', text, flags=re.M)
    while m:
        start = m.start()
        depth, i = 0, text.index('{', start)
        while i < len(text):
            if text[i] == '{': depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0: break
            i += 1
        block = text[start:i + 1]
        if re.search(r'server_name\s+zubingtan-w8\.corp\.pony\.ai', block):
            indent = re.match(r'(\s*)', block).group(1)
            text = text[:i] + f'\n{indent}    include {loc};' + text[i:]
            inserted = True
            break
        m = re.search(r'^\s*server\s*\{', text[m.end():], flags=re.M)
if not inserted and 'workflow-location.conf' not in text:
    print('ERROR: no zubingtan-w8.corp.pony.ai server block found to host /workflow')
    sys.exit(1)
open(path, 'w').write(text)
print('nginx site migrated: 8888 block dropped, workflow include inserted')
PY

# 3) Validate + activate. The legacy instance may have been started with
#    `-c /tmp/workflow-nginx.conf`; in that case reload cannot reach its
#    master (different pid/prefix), so restart against the main config.
if ! sudo nginx -t -c "$NGINX_MAIN" 2>/dev/null; then
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
mkdir -p "$SUPERVISOR_DIR"
mkdir -p "$WF_HOME/.config/workflow/logs"   # supervisord logfile targets (workflow.conf)
sed -e "s|/home/zubingtan|$WF_HOME|g" \
    -e "s|NODE_ENV=\"production\",|NODE_ENV=\"production\",|" \
    deploy/supervisord/workflow.conf > "$SUPERVISOR_DIR/workflow.conf"
supervisorctl reread || sudo supervisorctl reread
supervisorctl update || sudo supervisorctl update

say "bootstrap done. Next steps:"
say "  1. UI: fill Feishu App ID/Secret on the trigger + bot nodes (#298), pick the LLM agent"
say "  2. Import template: node deploy/import-template.mjs --base http://localhost:$PORT/workflow"
say "  3. Verify: bash deploy/verify/verify-feishu-echo.sh (local machine)"
