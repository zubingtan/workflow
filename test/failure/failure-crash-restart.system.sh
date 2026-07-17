#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."
project="workflow-pr5-${GITHUB_RUN_ID:-local}-$$"
app_port=$((32000 + ($$ % 1000)))
evidence=$(mktemp -d)
fixture_dir=$(mktemp -d)
caller_evidence="${EVIDENCE_DIR:-}"
export APP_PORT="$app_port"
custom_provider_key="PR5_CUSTOM_$(node -e 'process.stdout.write(crypto.randomUUID())')"
binding_raw_sentinel="PR5_BINDING_RAW_$(node -e 'process.stdout.write(crypto.randomUUID())')"
export WORKER_PROVIDER_TIMEOUT_MS=200
export WORKER_LEASE_MS=400
export WORKER_FAULT_HOOK=""
app_url="http://127.0.0.1:${app_port}"
write_valid_binding() {
cat >"$fixture_dir/provider-bindings.json" <<'JSON'
{"bindings":{"fake-default":{"provider":"openai-compatible","baseUrl":"http://fake-provider:4010/v1","apiKeyEnv":"CUSTOM_PROVIDER_KEY","model":"fake-m0","parameters":{"temperature":0}}}}
JSON
}
write_valid_binding
printf 'CUSTOM_PROVIDER_KEY=%s\n' "$custom_provider_key" >"$fixture_dir/worker.env"
cat >"$fixture_dir/compose.env" <<EOF
POSTGRES_DB=workflow
POSTGRES_USER=workflow
POSTGRES_PASSWORD=workflow
DATABASE_URL=postgres://workflow:workflow@postgres:5432/workflow
PROVIDER_BINDINGS_FILE=/run/provider-bindings.json
FAKE_PROVIDER_API_KEY=fixture-provider-key
APP_PORT=$app_port
WORKER_PROVIDER_TIMEOUT_MS=200
WORKER_LEASE_MS=400
WORKER_FAULT_HOOK=
WORKFLOW_ENV_FILE=$fixture_dir/worker.env
EOF
cat >"$fixture_dir/compose.override.yaml" <<EOF
services:
  app:
    environment:
      FAKE_PROVIDER_API_KEY: null
  worker:
    environment:
      FAKE_PROVIDER_API_KEY: null
    volumes:
      - $fixture_dir/provider-bindings.json:/run/provider-bindings.json:ro
  fake-provider:
    environment:
      FAKE_PROVIDER_API_KEY: null
      FAKE_PROVIDER_EXPECTED_API_KEY: $custom_provider_key
EOF
compose=(docker compose --project-name "$project" --env-file "$fixture_dir/compose.env" -f compose.yaml -f "$fixture_dir/compose.override.yaml")
LAST_RUN_ID=""

cleanup() {
  status=$?
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  if [[ -n "$caller_evidence" ]]; then
    mkdir -p "$caller_evidence/logs" "$caller_evidence/event-exports" "$caller_evidence/test-results/failure-system"
    for file in "$evidence"/*.log; do
      [[ -f "$file" ]] && cp "$file" "$caller_evidence/logs/failure-$(basename "$file")"
    done
    [[ -f "$evidence/database.jsonl" ]] && cp "$evidence/database.jsonl" "$caller_evidence/test-results/failure-system/database.jsonl"
    [[ -f "$evidence/api.jsonl" ]] && cp "$evidence/api.jsonl" "$caller_evidence/test-results/failure-system/api.jsonl"
    [[ -f "$evidence/events.jsonl" ]] && cp "$evidence/events.jsonl" "$caller_evidence/event-exports/failure-events.jsonl"
    for file in "$evidence"/*.json "$evidence"/*.txt; do
      [[ -f "$file" ]] && cp "$file" "$caller_evidence/test-results/failure-system/$(basename "$file")"
    done
  fi
  rm -rf "$evidence"
  rm -rf "$fixture_dir"
  exit "$status"
}
trap cleanup EXIT

query() { "${compose[@]}" exec -T postgres psql -X -U workflow -d workflow -Atc "$1"; }
assert_equal() { [[ "$1" == "$2" ]] || { echo "PR5 assertion failed" >&2; return 1; }; }

wait_healthy() {
  local service=$1 deadline=$((SECONDS + 90)) id
  while (( SECONDS < deadline )); do
    id=$("${compose[@]}" ps -q "$service")
    if [[ -n "$id" ]] && [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)" == healthy ]]; then return 0; fi
    sleep 1
  done
  echo "service readiness failed" >&2
  return 1
}

control_provider() {
  "${compose[@]}" exec -T -e CORRELATION="$1" -e MODE="$2" -e RAW_DETAIL="RAW_PROVIDER_DETAIL_MUST_NOT_ESCAPE" fake-provider node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:4010/test/control", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ correlationId: process.env.CORRELATION, mode: process.env.MODE, rawDetail: process.env.RAW_DETAIL }),
    });
    if (!response.ok) throw new Error("provider control failed");
  '
}

provider_calls() {
  "${compose[@]}" exec -T -e CORRELATION="$1" fake-provider node --input-type=module -e '
    const response = await fetch(`http://127.0.0.1:4010/test/stats?correlationId=${encodeURIComponent(process.env.CORRELATION)}`);
    const body = await response.json();
    if (!response.ok || !Number.isInteger(body.calls)) throw new Error("provider stats failed");
    process.stdout.write(String(body.calls));
  '
}

create_run() {
  CORRELATION="$1" APP_URL="$app_url" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.APP_URL}/api/runs`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ workflowDefinitionVersionId: "seed-workflow-v1", input: { prompt: `acceptance ${process.env.CORRELATION}` } }),
});
const body = await response.json();
if (response.status !== 202 || body.status !== "queued" || typeof body.runId !== "string") throw new Error("Run creation failed");
process.stdout.write(body.runId);
NODE
}

wait_status() {
  RUN_ID="$1" STATUS="$2" TIMEOUT_MS="${3:-90000}" APP_URL="$app_url" node --input-type=module <<'NODE'
const deadline = Date.now() + Number(process.env.TIMEOUT_MS);
while (Date.now() < deadline) {
  const response = await fetch(`${process.env.APP_URL}/api/runs/${process.env.RUN_ID}`, { cache: "no-store" });
  const body = await response.json();
  if (body.run?.status === process.env.STATUS) process.exit(0);
  if (["failed", "succeeded"].includes(body.run?.status)) throw new Error("Run reached the wrong terminal state");
  await new Promise((resolve) => setTimeout(resolve, 200));
}
throw new Error("Run did not reach a terminal state");
NODE
}

assert_failed_api() {
  RUN_ID="$1" CODE="$2" MESSAGE="$3" SECRET="$custom_provider_key" RAW_CONFIG="$binding_raw_sentinel" APP_URL="$app_url" EVIDENCE="$evidence/api.jsonl" node --input-type=module <<'NODE'
import { appendFile } from "node:fs/promises";
const fail = (condition) => { if (!condition) throw new Error("failed Run projection mismatch"); };
const response = await fetch(`${process.env.APP_URL}/api/runs/${process.env.RUN_ID}`, { cache: "no-store" });
const body = await response.json();
const expected = { code: process.env.CODE, message: process.env.MESSAGE, nodeId: "analyze" };
fail(response.ok && body.run?.status === "failed" && JSON.stringify(body.run.error) === JSON.stringify(expected));
const nodes = body.run.nodes;
fail(nodes[0].status === "succeeded" && nodes[0].error === null && nodes[0].skipReason === null);
fail(nodes[1].status === "failed" && JSON.stringify(nodes[1].error) === JSON.stringify(expected));
fail(JSON.stringify(nodes[1].attempt?.error) === JSON.stringify(expected));
fail(JSON.stringify(nodes[1].attempt?.agentExecution?.error) === JSON.stringify(expected));
fail(nodes[2].status === "skipped" && nodes[2].error === null && nodes[2].skipReason === "upstream_failed");
fail(nodes[2].attempt === null && nodes[2].output === null);
const historyResponse = await fetch(`${process.env.APP_URL}/api/workflows/seed-workflow/runs`, { cache: "no-store" });
const history = await historyResponse.json();
const item = history.runs?.find((run) => run.id === process.env.RUN_ID);
fail(JSON.stringify(item?.error) === JSON.stringify(expected));
const serialized = JSON.stringify([body, item]);
for (const forbidden of [process.env.SECRET, process.env.RAW_CONFIG, "http://fake-provider:4010/v1", "FAKE_PROVIDER_API_KEY", "RAW_PROVIDER_DETAIL_MUST_NOT_ESCAPE", "PiSession", "sessionId", "session_id"]) {
  if (forbidden && serialized.includes(forbidden)) throw new Error("API redaction failed");
}
await appendFile(process.env.EVIDENCE, `${serialized}\n`);
NODE
}

assert_failure_db() {
  local run_id=$1 code=$2 process_node output_node process_attempt execution_id expected_tail
  assert_equal "$(query "SELECT status||':'||error_code FROM workflow_runs WHERE id='$run_id'")" "failed:$code"
  assert_equal "$(query "SELECT string_agg(status||':'||coalesce(error_code,'')||':'||coalesce(skip_reason,''),',' ORDER BY execution_order) FROM node_runs WHERE workflow_run_id='$run_id'")" "succeeded::,failed:$code:,skipped::upstream_failed"
  assert_equal "$(query "SELECT count(*) FROM node_run_attempts attempt JOIN node_runs node ON node.id=attempt.node_run_id WHERE node.workflow_run_id='$run_id'")" "2"
  assert_equal "$(query "SELECT count(*) FROM agent_executions execution JOIN node_run_attempts attempt ON attempt.id=execution.node_run_attempt_id JOIN node_runs node ON node.id=attempt.node_run_id WHERE node.workflow_run_id='$run_id'")" "1"
  assert_equal "$(query "SELECT status FROM queue_jobs WHERE workflow_run_id='$run_id'")" "completed"
  assert_equal "$(query "SELECT string_agg(sequence||':'||type||':'||coalesce(error_code,'')||':'||coalesce(skip_reason,''),',' ORDER BY sequence) FROM execution_events WHERE workflow_run_id='$run_id' AND sequence>=7")" "7:agent.execution.failed:$code:,8:node.attempt.failed:$code:,9:node.run.skipped::upstream_failed,10:workflow.run.failed:$code:"
  process_node=$(query "SELECT id FROM node_runs WHERE workflow_run_id='$run_id' AND node_type='process.agent'")
  output_node=$(query "SELECT id FROM node_runs WHERE workflow_run_id='$run_id' AND node_type='output.markdown'")
  process_attempt=$(query "SELECT attempt.id FROM node_run_attempts attempt JOIN node_runs node ON node.id=attempt.node_run_id WHERE node.workflow_run_id='$run_id' AND node.node_type='process.agent'")
  execution_id=$(query "SELECT execution.id FROM agent_executions execution JOIN node_run_attempts attempt ON attempt.id=execution.node_run_attempt_id WHERE attempt.id='$process_attempt'")
  expected_tail="7:agent.execution.failed:$process_node:$process_attempt:$execution_id,8:node.attempt.failed:$process_node:$process_attempt:,9:node.run.skipped:$output_node::,10:workflow.run.failed:::"
  assert_equal "$(query "SELECT string_agg(sequence||':'||type||':'||coalesce(node_run_id,'')||':'||coalesce(attempt_id,'')||':'||coalesce(agent_execution_id,''),',' ORDER BY sequence) FROM execution_events WHERE workflow_run_id='$run_id' AND sequence>=7")" "$expected_tail"
}

start_worker() {
  export WORKER_FAULT_HOOK="${1:-}"
  "${compose[@]}" up -d --force-recreate worker
}
capture_worker_logs() { "${compose[@]}" logs --no-color worker >"$evidence/$1"; }
stop_worker() { "${compose[@]}" rm -sf worker >/dev/null 2>&1 || true; }
sweep() { "${compose[@]}" run --rm --no-deps -e WORKER_FAULT_HOOK= worker node scripts/worker.mjs --sweep-expired-leases >/dev/null; }

wait_expired_lease() {
  local run_id=$1 deadline=$((SECONDS + 30))
  while (( SECONDS < deadline )); do
    if [[ "$(query "SELECT count(*) FROM queue_jobs WHERE workflow_run_id='$run_id' AND status='leased' AND lease_expires_at<=now()")" == 1 ]]; then return 0; fi
    sleep 1
  done
  echo "lease did not expire" >&2
  return 1
}

wait_fault_state() {
  local run_id=$1 correlation=$2 request_state=$3 expected_calls=$4
  local deadline=$((SECONDS + 30)) id running request_marker result_marker
  while (( SECONDS < deadline )); do
    id=$("${compose[@]}" ps -a -q worker)
    running=$(docker inspect --format '{{.State.Running}}' "$id" 2>/dev/null || true)
    request_marker=$(query "SELECT CASE WHEN execution.provider_request_started_at IS NULL THEN 'null' ELSE 'set' END FROM agent_executions execution JOIN node_run_attempts attempt ON attempt.id=execution.node_run_attempt_id JOIN node_runs node ON node.id=attempt.node_run_id WHERE node.workflow_run_id='$run_id'")
    result_marker=$(query "SELECT CASE WHEN execution.provider_result_persisted_at IS NULL THEN 'null' ELSE 'set' END FROM agent_executions execution JOIN node_run_attempts attempt ON attempt.id=execution.node_run_attempt_id JOIN node_runs node ON node.id=attempt.node_run_id WHERE node.workflow_run_id='$run_id'")
    if [[ -n "$id" && "$running" == false \
      && "$(query "SELECT status FROM workflow_runs WHERE id='$run_id'")" == running \
      && "$(query "SELECT string_agg(status,',' ORDER BY execution_order) FROM node_runs WHERE workflow_run_id='$run_id'")" == succeeded,running,pending \
      && "$(query "SELECT string_agg(attempt.status,',' ORDER BY node.execution_order) FROM node_run_attempts attempt JOIN node_runs node ON node.id=attempt.node_run_id WHERE node.workflow_run_id='$run_id'")" == succeeded,running \
      && "$(query "SELECT execution.status FROM agent_executions execution JOIN node_run_attempts attempt ON attempt.id=execution.node_run_attempt_id JOIN node_runs node ON node.id=attempt.node_run_id WHERE node.workflow_run_id='$run_id'")" == running \
      && "$request_marker" == "$request_state" && "$result_marker" == null \
      && "$(query "SELECT string_agg(sequence||':'||type,',' ORDER BY sequence) FROM execution_events WHERE workflow_run_id='$run_id'")" == "1:workflow.run.queued,2:workflow.run.started,3:node.attempt.started,4:node.attempt.succeeded,5:node.attempt.started,6:agent.execution.started" \
      && "$(provider_calls "$correlation")" == "$expected_calls" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "fault worker did not stop at the exact pre-sweep state" >&2
  return 1
}

save_restart_projection() {
  RUN_ID="$1" APP_URL="$app_url" FILE="$2" node --input-type=module <<'NODE'
import { writeFile } from "node:fs/promises";
const detailResponse = await fetch(`${process.env.APP_URL}/api/runs/${process.env.RUN_ID}`, { cache: "no-store" });
const historyResponse = await fetch(`${process.env.APP_URL}/api/workflows/seed-workflow/runs`, { cache: "no-store" });
const detail = await detailResponse.json();
const history = await historyResponse.json();
const historyItem = history.runs?.find((run) => run.id === process.env.RUN_ID);
if (!detailResponse.ok || !historyResponse.ok || detail.run?.id !== process.env.RUN_ID || historyItem?.id !== process.env.RUN_ID) {
  throw new Error("restart projection capture failed");
}
await writeFile(process.env.FILE, JSON.stringify({ detail, historyItem }));
NODE
}

failure_case() {
  local correlation=$1 mode=$2 code=$3 message=$4
  control_provider "$correlation" "$mode"
  local run_id
  run_id=$(create_run "$correlation")
  wait_status "$run_id" failed
  assert_failed_api "$run_id" "$code" "$message"
  assert_failure_db "$run_id" "$code"
  assert_equal "$(provider_calls "$correlation")" 1
  LAST_RUN_ID=$run_id
}

configuration_failure_case() {
  local correlation=$1
  control_provider "$correlation" success
  start_worker
  wait_healthy worker
  local run_id
  run_id=$(create_run "$correlation")
  wait_status "$run_id" failed 10000
  assert_failed_api "$run_id" provider_auth_failed "Provider authentication failed"
  assert_failure_db "$run_id" provider_auth_failed
  assert_equal "$(provider_calls "$correlation")" 0
}

"${compose[@]}" build
"${compose[@]}" up -d postgres fake-provider
wait_healthy postgres
wait_healthy fake-provider
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d app
wait_healthy app
start_worker
wait_healthy worker

control_provider pr5-missing-key success
: >"$fixture_dir/worker.env"
start_worker
wait_healthy worker
missing_key_id=$(create_run pr5-missing-key)
wait_status "$missing_key_id" failed 10000
assert_failed_api "$missing_key_id" provider_auth_failed "Provider authentication failed"
assert_failure_db "$missing_key_id" provider_auth_failed
assert_equal "$(provider_calls pr5-missing-key)" 0
printf 'CUSTOM_PROVIDER_KEY=%s\n' "$custom_provider_key" >"$fixture_dir/worker.env"
start_worker
wait_healthy worker

printf '{"raw":"%s",' "$binding_raw_sentinel" >"$fixture_dir/provider-bindings.json"
configuration_failure_case pr5-invalid-binding-json
printf '{"bindings":{"different-alias":{"raw":"%s"}}}\n' "$binding_raw_sentinel" >"$fixture_dir/provider-bindings.json"
configuration_failure_case pr5-missing-binding-alias
write_valid_binding
start_worker
wait_healthy worker

failure_case pr5-auth auth_failure provider_auth_failed "Provider authentication failed"
auth_id=$LAST_RUN_ID
failure_case pr5-timeout timeout provider_timeout "Provider request timed out"
timeout_id=$LAST_RUN_ID
failure_case pr5-empty empty_output provider_empty_output "Provider returned empty output"
empty_id=$LAST_RUN_ID

capture_worker_logs worker-provider-failures.log
stop_worker
control_provider pr5-crash-before success
before_id=$(create_run pr5-crash-before)
start_worker before_model_request
wait_fault_state "$before_id" pr5-crash-before null 0
wait_expired_lease "$before_id"
assert_equal "$(provider_calls pr5-crash-before)" 0
sweep
wait_status "$before_id" failed
assert_failed_api "$before_id" worker_lost "Worker was lost before provider dispatch"
assert_failure_db "$before_id" worker_lost
sweep
assert_equal "$(provider_calls pr5-crash-before)" 0

capture_worker_logs worker-crash-before.log
stop_worker
control_provider pr5-crash-after success
after_id=$(create_run pr5-crash-after)
start_worker after_model_request_before_persist
wait_fault_state "$after_id" pr5-crash-after set 1
wait_expired_lease "$after_id"
assert_equal "$(provider_calls pr5-crash-after)" 1
sweep
wait_status "$after_id" failed
assert_failed_api "$after_id" outcome_unknown "Provider outcome is unknown"
assert_failure_db "$after_id" outcome_unknown
sweep
assert_equal "$(provider_calls pr5-crash-after)" 1

capture_worker_logs worker-crash-after.log
stop_worker
start_worker
wait_healthy worker
control_provider pr5-restart-success success
success_id=$(create_run pr5-restart-success)
wait_status "$success_id" succeeded
assert_equal "$(provider_calls pr5-restart-success)" 1

: >"$evidence/calls-before-restart.txt"
for expected in pr5-auth:1 pr5-timeout:1 pr5-empty:1 pr5-crash-before:0 pr5-crash-after:1 pr5-restart-success:1; do
  correlation=${expected%:*}
  expected_calls=${expected##*:}
  actual_calls=$(provider_calls "$correlation")
  assert_equal "$actual_calls" "$expected_calls"
  printf '%s:%s\n' "$correlation" "$actual_calls" >>"$evidence/calls-before-restart.txt"
done
save_restart_projection "$success_id" "$evidence/success-before.json"
save_restart_projection "$auth_id" "$evidence/failure-before.json"
"${compose[@]}" logs --no-color app worker fake-provider >"$evidence/services-before-restart.log"
"${compose[@]}" down
"${compose[@]}" up -d postgres fake-provider
wait_healthy postgres
wait_healthy fake-provider
"${compose[@]}" run --rm migrate
start_worker
"${compose[@]}" up -d app
wait_healthy worker
wait_healthy app
wait_status "$success_id" succeeded
wait_status "$auth_id" failed
save_restart_projection "$success_id" "$evidence/success-after.json"
save_restart_projection "$auth_id" "$evidence/failure-after.json"
cmp "$evidence/success-before.json" "$evidence/success-after.json"
cmp "$evidence/failure-before.json" "$evidence/failure-after.json"
: >"$evidence/calls-after-restart.txt"
for correlation in pr5-auth pr5-timeout pr5-empty pr5-crash-before pr5-crash-after pr5-restart-success; do
  actual_calls=$(provider_calls "$correlation")
  assert_equal "$actual_calls" 0
  printf '%s:%s\n' "$correlation" "$actual_calls" >>"$evidence/calls-after-restart.txt"
done
assert_equal "$(query "SELECT count(*) FROM execution_events WHERE workflow_run_id='$success_id'")" 12
assert_equal "$(query "SELECT count(*) FROM execution_events WHERE workflow_run_id='$auth_id'")" 10

"${compose[@]}" logs --no-color app worker fake-provider >"$evidence/services-after-restart.log"
for table in workflow_runs node_runs node_run_attempts agent_executions execution_events; do
  query "SELECT row_to_json(value)::text FROM (SELECT * FROM $table) value" >>"$evidence/database.jsonl"
done
query "SELECT row_to_json(value)::text FROM (SELECT * FROM execution_events ORDER BY workflow_run_id, sequence) value" >"$evidence/events.jsonl"
scan_failed=0
for file in "$evidence"/*; do
  for forbidden in "$custom_provider_key" "$binding_raw_sentinel" "http://fake-provider:4010/v1" "CUSTOM_PROVIDER_KEY" "apiKeyEnv" "FAKE_PROVIDER_API_KEY" "RAW_PROVIDER_DETAIL_MUST_NOT_ESCAPE" "PiSession" "sessionId" "session_id"; do
    if grep -Fq "$forbidden" "$file"; then scan_failed=1; fi
  done
done
if [[ "$scan_failed" == 1 ]]; then echo "PR5 redaction scan failed" >&2; exit 1; fi

echo "M0-T06/T07/T07E/T08/T09/T11 system acceptance passed"
