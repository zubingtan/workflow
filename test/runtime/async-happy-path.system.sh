#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

project="workflow-pr4-${GITHUB_RUN_ID:-local}-$$"
app_port=$((31000 + ($$ % 1000)))
export APP_PORT="$app_port"
compose=(docker compose --project-name "$project" --env-file .env.example -f compose.yaml)
app_url="http://127.0.0.1:${app_port}"
evidence_dir="${EVIDENCE_DIR:-}"
if [[ -n "$evidence_dir" ]]; then
  mkdir -p "$evidence_dir/logs" "$evidence_dir/event-exports" "$evidence_dir/test-results"
fi

cleanup() {
  status=$?
  if (( status != 0 )); then
    "${compose[@]}" ps || true
    "${compose[@]}" logs --no-color || true
    if [[ -n "$evidence_dir" ]]; then
      "${compose[@]}" logs --no-color >"$evidence_dir/logs/async-happy-path.log" 2>&1 || true
    fi
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

wait_healthy() {
  local service=$1
  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    local id health
    id=$("${compose[@]}" ps -q "$service")
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)
    if [[ "$health" == "healthy" ]]; then return 0; fi
    sleep 1
  done
  echo "$service did not become healthy" >&2
  return 1
}

provider_calls() {
  "${compose[@]}" exec -T fake-provider node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:4010/test/stats");
    if (!response.ok) throw new Error(`stats returned ${response.status}`);
    const body = await response.json();
    if (!Number.isInteger(body.calls)) throw new Error("stats.calls must be an integer");
    process.stdout.write(String(body.calls));
  '
}

reset_provider_stats() {
  "${compose[@]}" exec -T fake-provider node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:4010/test/stats", { method: "DELETE" });
    if (!response.ok) throw new Error(`stats reset returned ${response.status}`);
  '
}

wait_workers_healthy() {
  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    local ids count all_healthy
    ids=$("${compose[@]}" ps -q worker)
    count=$(printf '%s\n' "$ids" | sed '/^$/d' | wc -l | tr -d ' ')
    all_healthy=1
    if [[ "$count" == "2" ]]; then
      for id in $ids; do
        if [[ "$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id" 2>/dev/null || true)" != "healthy" ]]; then
          all_healthy=0
        fi
      done
      if [[ "$all_healthy" == "1" ]]; then return 0; fi
    fi
    sleep 1
  done
  echo "expected exactly two healthy worker containers" >&2
  return 1
}

create_run() {
  PROMPT="$1" APP_URL="$app_url" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.APP_URL}/api/runs`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    workflowDefinitionVersionId: "seed-workflow-v1",
    input: { prompt: process.env.PROMPT },
  }),
});
const body = await response.json();
if (response.status !== 202) throw new Error(`expected 202, got ${response.status}: ${JSON.stringify(body)}`);
if (body.status !== "queued" || typeof body.runId !== "string" || Object.keys(body).sort().join(",") !== "runId,status") {
  throw new Error(`unexpected create response: ${JSON.stringify(body)}`);
}
process.stdout.write(body.runId);
NODE
}

wait_run_succeeded() {
  RUN_ID="$1" APP_URL="$app_url" node --input-type=module <<'NODE'
const deadline = Date.now() + 90_000;
let body;
while (Date.now() < deadline) {
  const response = await fetch(`${process.env.APP_URL}/api/runs/${process.env.RUN_ID}`, { cache: "no-store" });
  body = await response.json();
  if (body.run?.status === "succeeded") process.exit(0);
  if (body.run?.status === "failed") throw new Error(`Run failed: ${JSON.stringify(body)}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
}
throw new Error(`Run did not succeed before deadline: ${JSON.stringify(body)}`);
NODE
}

query() {
  "${compose[@]}" exec -T postgres psql -X -U workflow -d workflow -Atc "$1"
}

assert_equal() {
  if [[ "$1" != "$2" ]]; then
    echo "expected '$2', got '$1'" >&2
    return 1
  fi
}

"${compose[@]}" build
"${compose[@]}" up -d postgres fake-provider
wait_healthy postgres
wait_healthy fake-provider
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d app
wait_healthy app

reset_provider_stats
run_a_id=$(create_run "Run A proves app-only queueing")

RUN_ID="$run_a_id" APP_URL="$app_url" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.APP_URL}/api/runs/${process.env.RUN_ID}`);
const body = await response.json();
if (!response.ok || body.run?.status !== "queued") throw new Error(`Run did not remain queued: ${JSON.stringify(body)}`);
if (body.run.nodes.map((node) => node.status).join(",") !== "queued,pending,pending") {
  throw new Error(`unexpected queued nodes: ${JSON.stringify(body.run.nodes)}`);
}
if (body.run.nodes.some((node) => node.attempt !== null)) throw new Error("queued Run already has an Attempt");
NODE
assert_equal "$(provider_calls)" "0"

"${compose[@]}" up -d --scale worker=2 worker
wait_workers_healthy
wait_run_succeeded "$run_a_id"
assert_equal "$(provider_calls)" "1"

reset_provider_stats
assert_equal "$(provider_calls)" "0"
run_b_id=$(create_run "Run B proves the two-worker claim race")

RUN_ID="$run_b_id" APP_URL="$app_url" node --input-type=module <<'NODE'
const deadline = Date.now() + 90_000;
let body;
while (Date.now() < deadline) {
  const response = await fetch(`${process.env.APP_URL}/api/runs/${process.env.RUN_ID}`, { cache: "no-store" });
  body = await response.json();
  if (body.run?.status === "succeeded") break;
  if (body.run?.status === "failed") throw new Error(`Run failed: ${JSON.stringify(body)}`);
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (body?.run?.status !== "succeeded") throw new Error(`Run did not succeed before deadline: ${JSON.stringify(body)}`);
if (body.run.error !== null || body.run.nodes.some((node) => node.error !== null || node.skipReason !== null)) {
  throw new Error("successful projection must expose null failure fields");
}
if (body.run.nodes.map((node) => `${node.type}:${node.status}`).join(",") !==
  "input.prompt:succeeded,process.agent:succeeded,output.markdown:succeeded") {
  throw new Error(`unexpected final nodes: ${JSON.stringify(body.run.nodes)}`);
}
if (body.run.nodes.some((node) => node.attempt?.number !== 1 || node.attempt?.status !== "succeeded")) {
  throw new Error(`expected one succeeded Attempt per node: ${JSON.stringify(body.run.nodes)}`);
}
if (body.run.nodes.some((node) => node.attempt?.error !== null)) {
  throw new Error("successful Attempts must expose error null");
}
const processNode = body.run.nodes[1];
const outputNode = body.run.nodes[2];
if (processNode.attempt.agentExecution?.error !== null) {
  throw new Error("successful Agent Execution must expose error null");
}
const snapshot = {
  bindingAlias: "fake-default",
  effectiveProvider: "openai-compatible",
  effectiveModel: "fake-m0",
  parameters: { temperature: 0 },
};
if (JSON.stringify(processNode.attempt.providerSnapshot) !== JSON.stringify(snapshot)) {
  throw new Error(`unexpected Attempt snapshot: ${JSON.stringify(processNode.attempt.providerSnapshot)}`);
}
if (JSON.stringify(processNode.attempt.agentExecution?.providerSnapshot) !== JSON.stringify(snapshot)) {
  throw new Error(`unexpected Agent Execution snapshot: ${JSON.stringify(processNode.attempt.agentExecution)}`);
}
if (outputNode.output?.markdown !== "Fake provider response") {
  throw new Error(`Markdown output was not persisted: ${JSON.stringify(outputNode.output)}`);
}
const serialized = JSON.stringify(body);
for (const forbidden of ["http://fake-provider", "FAKE_PROVIDER_API_KEY", "fake-provider-local", "sessionId", "session_id", "PiSession"]) {
  if (serialized.includes(forbidden)) throw new Error(`Run API leaked ${forbidden}`);
}
NODE

assert_equal "$(provider_calls)" "1"
assert_equal "$(query "SELECT count(*) FROM queue_jobs WHERE workflow_run_id = '$run_b_id'")" "1"
assert_equal "$(query "SELECT count(*) FROM queue_jobs WHERE workflow_run_id = '$run_b_id' AND status = 'completed' AND lease_owner IS NOT NULL AND lease_owner <> ''")" "1"
assert_equal "$(query "SELECT count(*) FROM node_run_attempts attempt JOIN node_runs node ON node.id = attempt.node_run_id WHERE node.workflow_run_id = '$run_b_id'")" "3"
assert_equal "$(query "SELECT count(*) FROM node_run_attempts attempt JOIN node_runs node ON node.id = attempt.node_run_id WHERE node.workflow_run_id = '$run_b_id' AND attempt.number = 1 AND attempt.status = 'succeeded'")" "3"
assert_equal "$(query "SELECT count(*) FROM agent_executions execution JOIN node_run_attempts attempt ON attempt.id = execution.node_run_attempt_id JOIN node_runs node ON node.id = attempt.node_run_id WHERE node.workflow_run_id = '$run_b_id'")" "1"
assert_equal "$(query "SELECT count(*) FROM agent_executions execution JOIN node_run_attempts attempt ON attempt.id = execution.node_run_attempt_id JOIN node_runs node ON node.id = attempt.node_run_id WHERE node.workflow_run_id = '$run_b_id' AND execution.status = 'succeeded'")" "1"
assert_equal "$(query "SELECT count(*) FROM node_runs WHERE workflow_run_id = '$run_b_id' AND node_type = 'output.markdown' AND output->>'markdown' = 'Fake provider response'")" "1"
assert_equal "$(query "SELECT count(*) FROM execution_events WHERE workflow_run_id = '$run_b_id'")" "11"

events=$(query "
  SELECT json_agg(json_build_object(
    'sequence', event.sequence,
    'type', event.type,
    'nodeId', node.node_id,
    'nodeRunId', event.node_run_id,
    'attemptId', event.attempt_id,
    'agentExecutionId', event.agent_execution_id
  ) ORDER BY event.sequence)::text
  FROM execution_events event
  LEFT JOIN node_runs node ON node.id = event.node_run_id
  WHERE event.workflow_run_id = '$run_b_id'
")
EVENTS="$events" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
const events = JSON.parse(process.env.EVENTS);
assert.deepEqual(events.map(({ sequence, type, nodeId }) => ({ sequence, type, nodeId })), [
  { sequence: 1, type: "workflow.run.queued", nodeId: null },
  { sequence: 2, type: "workflow.run.started", nodeId: null },
  { sequence: 3, type: "node.attempt.started", nodeId: "prompt" },
  { sequence: 4, type: "node.attempt.succeeded", nodeId: "prompt" },
  { sequence: 5, type: "node.attempt.started", nodeId: "analyze" },
  { sequence: 6, type: "agent.execution.started", nodeId: "analyze" },
  { sequence: 7, type: "agent.execution.succeeded", nodeId: "analyze" },
  { sequence: 8, type: "node.attempt.succeeded", nodeId: "analyze" },
  { sequence: 9, type: "node.attempt.started", nodeId: "result" },
  { sequence: 10, type: "node.attempt.succeeded", nodeId: "result" },
  { sequence: 11, type: "workflow.run.succeeded", nodeId: null },
]);

for (const index of [0, 1, 10]) {
  assert.deepEqual(
    [events[index].nodeRunId, events[index].attemptId, events[index].agentExecutionId],
    [null, null, null],
  );
}
function assertAttemptPair(firstIndex, secondIndex) {
  const first = events[firstIndex];
  const second = events[secondIndex];
  assert.equal(typeof first.nodeRunId, "string");
  assert.equal(typeof first.attemptId, "string");
  assert.equal(first.agentExecutionId, null);
  assert.deepEqual(
    [second.nodeRunId, second.attemptId, second.agentExecutionId],
    [first.nodeRunId, first.attemptId, null],
  );
}
assertAttemptPair(2, 3);
assertAttemptPair(4, 7);
assertAttemptPair(8, 9);
for (const index of [5, 6]) {
  assert.deepEqual(
    [events[index].nodeRunId, events[index].attemptId],
    [events[4].nodeRunId, events[4].attemptId],
  );
  assert.equal(typeof events[index].agentExecutionId, "string");
}
assert.equal(events[5].agentExecutionId, events[6].agentExecutionId);
NODE

snapshots=$(query "
  SELECT json_build_object(
    'attempt', attempt.provider_snapshot,
    'execution', execution.provider_snapshot
  )::text
  FROM node_run_attempts attempt
  JOIN node_runs node ON node.id = attempt.node_run_id
  JOIN agent_executions execution ON execution.node_run_attempt_id = attempt.id
  WHERE node.workflow_run_id = '$run_b_id'
    AND node.node_type = 'process.agent'
")
SNAPSHOTS="$snapshots" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
const snapshots = JSON.parse(process.env.SNAPSHOTS);
const expected = {
  bindingAlias: "fake-default",
  effectiveProvider: "openai-compatible",
  effectiveModel: "fake-m0",
  parameters: { temperature: 0 },
};
assert.deepEqual(snapshots.attempt, expected);
assert.deepEqual(snapshots.execution, expected);
assert.deepEqual(snapshots.attempt, snapshots.execution);
const serialized = JSON.stringify(snapshots);
for (const forbidden of ["baseUrl", "apiKey", "apiKeyEnv", "fake-provider-local", "sessionId", "session_id", "PiSession"]) {
  assert.ok(!serialized.includes(forbidden), `provider snapshot leaked ${forbidden}`);
}
NODE

if query "UPDATE execution_events SET type = type WHERE workflow_run_id = '$run_b_id'" >/dev/null 2>&1; then
  echo "execution events accepted UPDATE" >&2
  exit 1
fi
if query "DELETE FROM execution_events WHERE workflow_run_id = '$run_b_id'" >/dev/null 2>&1; then
  echo "execution events accepted DELETE" >&2
  exit 1
fi

if [[ -n "$evidence_dir" ]]; then
  printf '%s\n' "$events" >"$evidence_dir/event-exports/async-happy-events.json"
  "${compose[@]}" logs --no-color app worker fake-provider >"$evidence_dir/logs/async-happy-path.log"
  printf '{"runId":"%s","result":"PASS"}\n' "$run_b_id" >"$evidence_dir/test-results/async-happy-path.json"
fi

echo "M0-T05 async happy path passed for $run_b_id"
