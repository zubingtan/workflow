#!/usr/bin/env bash
# #296: automated Feishu echo verification — the "at bot, read reply" loop.
#
# Runs from your LOCAL machine (feishu-im needs your Feishu login/MCP URL).
# It drives a real group conversation:
#
#   1. register a deterministic fake-provider reply (correlationId → rawDetail)
#   2. send a real @bot message carrying the correlationId to Bot Testing
#   3. poll the thread until the bot's reply appears (workflow: trigger → LLM
#      → in-thread reply, #294 template)
#   4. assert the reply text EXACTLY equals the registered rawDetail
#
# Prereqs (local):
#   - FEISHU_IM_MCP_URL exported (see ~/.zshrc; feishu-im skill)
#   - python3 + curl
#   - the workflow instance's trigger/bot credentials filled in and the LLM
#     agent pointed at the fake-provider (deploy/README.md)
#
# Usage:
#   bash deploy/verify/verify-feishu-echo.sh [--fake-base http://10.8.184.96:4010]
set -euo pipefail

# --- Config (override via env) ---
FAKE_BASE="${FAKE_BASE:-http://10.8.184.96:4010}"          # w8 fake-provider
CHAT_ID="${CHAT_ID:-oc_0da8b36e7656ca1768a04e720c190c15}"   # Bot Testing group
BOT_OPEN_ID="${BOT_OPEN_ID:-ou_e848234a502c6fb8c32fab1321cbd84c}" # Localization Team Bot
FEISHU_IM_SCRIPT="${FEISHU_IM_SCRIPT:-$HOME/.agents/skills/feishu-im/scripts/feishu_im.py}"
POLL_TIMEOUT_S="${POLL_TIMEOUT_S:-90}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-10}"

if [ "${1:-}" = "--fake-base" ]; then FAKE_BASE="${2:-$FAKE_BASE}"; fi

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n✗ %s\n' "$*" >&2; exit 1; }

[ -n "${FEISHU_IM_MCP_URL:-}" ] || die "FEISHU_IM_MCP_URL not set (feishu-im skill)"
[ -x "$(command -v python3)" ] || die "python3 missing"

TS="$(date +%s)"
CID="verify-$TS"
DETAIL="echo-$TS"

# --- 1. Register the deterministic reply ---
say "1/4 register fake-provider control: $CID -> $DETAIL"
curl -fsS -X PUT "$FAKE_BASE/test/control" \
  -H 'Content-Type: application/json' \
  -d "{\"correlationId\":\"$CID\",\"rawDetail\":\"$DETAIL\",\"mode\":\"success\"}" >/dev/null \
  || die "fake-provider control failed at $FAKE_BASE (is it up?)"

# --- 2. Send the real @bot message ---
say "2/4 send @bot message to group $CHAT_ID"
SEND_OUT="$(python3 "$FEISHU_IM_SCRIPT" send chat_id "$CHAT_ID" "$CID" --at "$BOT_OPEN_ID")"
echo "$SEND_OUT"
MESSAGE_ID="$(echo "$SEND_OUT" | grep -oP 'om_[A-Za-z0-9]+' | head -1 || true)"
[ -n "$MESSAGE_ID" ] || die "could not extract message_id from send output"

# --- 3. Find the thread_id (feishu-im prints it on the message's line) ---
# The bot replies with reply_in_thread, which CREATES a thread whose id may
# differ from the sent message's own thread_id — and plain (non-threaded)
# messages have no thread_id at all. So: try the sent message's thread first,
# fall back to scanning the group feed for the expected reply text.
say "3/4 locate reply target (thread_id, or group feed fallback)"
THREAD_ID="$(python3 "$FEISHU_IM_SCRIPT" messages "$CHAT_ID" 2>/dev/null \
  | awk -v mid="$MESSAGE_ID" '
      $0 ~ "\\[" mid "\\]" { in_msg = 1 }
      in_msg && /thread_id:/ { print $2; exit }
    ' || true)"
if [ -n "$THREAD_ID" ]; then
  say "4/4 poll thread $THREAD_ID for reply == $DETAIL (timeout ${POLL_TIMEOUT_S}s)"
  POLL_CMD=("$FEISHU_IM_SCRIPT" thread "$THREAD_ID")
else
  say "4/4 (fallback) poll group feed for reply == $DETAIL (timeout ${POLL_TIMEOUT_S}s)"
  POLL_CMD=("$FEISHU_IM_SCRIPT" messages "$CHAT_ID")
fi

# --- 4. Poll until the exact reply appears ---
deadline=$(( $(date +%s) + POLL_TIMEOUT_S ))
while :; do
  REPLY="$(python3 "${POLL_CMD[@]}" 2>/dev/null | grep -F "$DETAIL" || true)"
  if [ -n "$REPLY" ]; then
    echo "✓ bot replied: $REPLY"
    echo "✓ VERIFIED (correlationId=$CID, expected=$DETAIL)"
    exit 0
  fi
  now="$(date +%s)"
  [ "$now" -ge "$deadline" ] && break
  sleep "$POLL_INTERVAL_S"
done

die "timeout: no reply matching '$DETAIL' (correlationId=$CID). Check workflow run history on the dashboard."
