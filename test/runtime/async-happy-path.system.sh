#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

project="workflow-pr4-${GITHUB_RUN_ID:-local}-$$"
app_port=$((31000 + ($$ % 1000)))
export APP_PORT="$app_port"
fixture_dir=$(mktemp -d)
custom_provider_key="PR4_CUSTOM_$(node -e 'process.stdout.write(crypto.randomUUID())')"
cat >"$fixture_dir/provider-bindings.json" <<'JSON'
{"bindings":{"fake-default":{"provider":"openai-compatible","baseUrl":"http://fake-provider:4010/v1","apiKeyEnv":"CUSTOM_PROVIDER_KEY","model":"fake-m0","parameters":{"temperature":0}}}}
JSON
cat >"$fixture_dir/worker.env" <<EOF
CUSTOM_PROVIDER_KEY=$custom_provider_key
EOF
cat >"$fixture_dir/compose.env" <<EOF
POSTGRES_DB=workflow
POSTGRES_USER=workflow
POSTGRES_PASSWORD=workflow
DATABASE_URL=postgres://workflow:workflow@postgres:5432/workflow
PROVIDER_BINDINGS_FILE=/run/provider-bindings.json
FAKE_PROVIDER_API_KEY=fixture-provider-key
APP_PORT=$app_port
WORKER_PROVIDER_TIMEOUT_MS=30000
WORKER_LEASE_MS=300000
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
app_url="http://127.0.0.1:${app_port}"
evidence_dir="${EVIDENCE_DIR:-}"
if [[ -n "$evidence_dir" ]]; then
  mkdir -p "$evidence_dir/logs" "$evidence_dir/event-exports" "$evidence_dir/test-results"
fi

cleanup() {
  status=$?
  if (( status != 0 )); then
    "${compose[@]}" ps || true
    if [[ -n "$evidence_dir" ]]; then
      "${compose[@]}" logs --no-color >"$evidence_dir/logs/async-happy-path.log" 2>&1 || true
    fi
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$fixture_dir"
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
    if (!response.ok) throw new Error("provider stats request failed");
    const body = await response.json();
    if (!Number.isInteger(body.calls)) throw new Error("stats.calls must be an integer");
    process.stdout.write(String(body.calls));
  '
}

provider_authorization_matches() {
  "${compose[@]}" exec -T fake-provider node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:4010/test/stats");
    const body = await response.json();
    process.stdout.write(String(body.authorizationMatched === true));
  '
}

reset_provider_stats() {
  "${compose[@]}" exec -T fake-provider node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:4010/test/stats", { method: "DELETE" });
    if (!response.ok) throw new Error("provider stats reset failed");
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
if (response.status !== 202) throw new Error("Run creation returned an unexpected status");
if (body.status !== "queued" || typeof body.runId !== "string" || Object.keys(body).sort().join(",") !== "runId,status") {
  throw new Error("Run creation returned an unexpected projection");
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
  if (body.run?.status === "failed") throw new Error("Run reached a failed terminal state");
  await new Promise((resolve) => setTimeout(resolve, 250));
}
throw new Error("Run did not succeed before deadline");
NODE
}

query() {
  "${compose[@]}" exec -T postgres psql -X -U workflow -d workflow -Atc "$1"
}

assert_equal() {
  if [[ "$1" != "$2" ]]; then
    echo "async system assertion failed" >&2
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
app_id=$("${compose[@]}" ps -q app)
app_environment=$(docker inspect --format '{{json .Config.Env}}' "$app_id")
if [[ "$app_environment" == *CUSTOM_PROVIDER_KEY* || "$app_environment" == *"$custom_provider_key"* ]]; then
  echo "app received the worker provider credential" >&2
  exit 1
fi

reset_provider_stats
run_a_id=$(create_run "Run A proves app-only queueing")

RUN_ID="$run_a_id" APP_URL="$app_url" node --input-type=module <<'NODE'
const response = await fetch(`${process.env.APP_URL}/api/runs/${process.env.RUN_ID}`);
const body = await response.json();
if (!response.ok || body.run?.status !== "queued") throw new Error("Run did not remain queued");
if (body.run.nodes.map((node) => node.status).join(",") !== "queued,pending,pending") {
  throw new Error("queued node projection mismatch");
}
if (body.run.nodes.some((node) => node.attempt !== null)) throw new Error("queued Run already has an Attempt");
NODE
assert_equal "$(provider_calls)" "0"

"${compose[@]}" up -d --scale worker=2 worker
wait_workers_healthy
for worker_id in $("${compose[@]}" ps -q worker); do
  worker_environment=$(docker inspect --format '{{json .Config.Env}}' "$worker_id")
  if [[ "$worker_environment" != *"CUSTOM_PROVIDER_KEY=$custom_provider_key"* ]]; then
    echo "worker did not receive the custom provider credential" >&2
    exit 1
  fi
done
wait_run_succeeded "$run_a_id"
assert_equal "$(provider_calls)" "1"
assert_equal "$(provider_authorization_matches)" "true"

reset_provider_stats
assert_equal "$(provider_calls)" "0"
run_b_prompt="M1-C timeline must not repeat this prompt"
run_b_id=$(create_run "$run_b_prompt")

RUN_ID="$run_b_id" APP_URL="$app_url" PROMPT="$run_b_prompt" SECRET="$custom_provider_key" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const deadline = Date.now() + 90_000;
let body;
while (Date.now() < deadline) {
  const response = await fetch(`${process.env.APP_URL}/api/runs/${process.env.RUN_ID}`, { cache: "no-store" });
  body = await response.json();
  if (body.run?.status === "succeeded") break;
  if (body.run?.status === "failed") throw new Error("Run reached a failed terminal state");
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (body?.run?.status !== "succeeded") throw new Error("Run did not succeed before deadline");
if (body.run.error !== null || body.run.nodes.some((node) => node.error !== null || node.skipReason !== null)) {
  throw new Error("successful projection must expose null failure fields");
}
if (body.run.nodes.map((node) => `${node.type}:${node.status}`).join(",") !==
  "input.prompt:succeeded,process.agent:succeeded,output.markdown:succeeded") {
  throw new Error("final node projection mismatch");
}
if (body.run.nodes.some((node) => node.attempt?.number !== 1 || node.attempt?.status !== "succeeded")) {
  throw new Error("Attempt projection mismatch");
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
  throw new Error("Attempt provider snapshot mismatch");
}
if (JSON.stringify(processNode.attempt.agentExecution?.providerSnapshot) !== JSON.stringify(snapshot)) {
  throw new Error("Agent Execution provider snapshot mismatch");
}
if (outputNode.output?.markdown !== "Fake provider response") {
  throw new Error("Markdown output was not persisted");
}
const timeline = body.run.timeline;
if (!Array.isArray(timeline)) throw new Error("Run detail must return an execution timeline");
const expectedTimeline = [
  [1, "workflow.run.queued", null, null, null, false],
  [2, "workflow.run.started", null, null, null, false],
  [3, "node.attempt.started", "prompt", null, null, false],
  [4, "node.attempt.succeeded", "prompt", null, null, false],
  [5, "node.attempt.started", "analyze", null, null, false],
  [6, "agent.execution.started", "analyze", null, null, false],
  [7, "agent.execution.succeeded", "analyze", null, null, false],
  [8, "node.attempt.succeeded", "analyze", null, null, false],
  [9, "node.attempt.started", "result", null, null, false],
  [10, "node.attempt.succeeded", "result", null, null, false],
  [11, "artifact.created", "result", null, null, true],
  [12, "workflow.run.succeeded", null, null, null, false],
];
assert.deepStrictEqual(timeline.map((event) => [
  event.sequence,
  event.type,
  event.nodeId ?? null,
  event.code ?? null,
  event.reason ?? null,
  event.artifact !== undefined,
]), expectedTimeline);
const allowedTimelineKeys = new Set([
  "sequence", "type", "occurredAt", "nodeId", "code", "reason", "artifact",
]);
for (const event of timeline) {
  if (Object.keys(event).some((key) => !allowedTimelineKeys.has(key))) {
    throw new Error("Run timeline exposed a non-public event field");
  }
  if (!Number.isInteger(event.sequence) || typeof event.type !== "string") {
    throw new Error("Run timeline event identity is invalid");
  }
  if (typeof event.occurredAt !== "string" || Number.isNaN(Date.parse(event.occurredAt))) {
    throw new Error("Run timeline event timestamp is invalid");
  }
  if (event.nodeId !== undefined && typeof event.nodeId !== "string") {
    throw new Error("Run timeline node reference is invalid");
  }
  if (event.code !== undefined && typeof event.code !== "string") {
    throw new Error("Run timeline code is invalid");
  }
  if (event.reason !== undefined && typeof event.reason !== "string") {
    throw new Error("Run timeline reason is invalid");
  }
}
const artifact = timeline.find((event) => event.type === "artifact.created")?.artifact;
assert.deepStrictEqual(artifact, {
  source: { kind: "node.output", nodeId: "result" },
  sha256: createHash("sha256").update(outputNode.output.markdown, "utf8").digest("hex"),
  mediaType: "text/markdown",
  sizeBytes: Buffer.byteLength(outputNode.output.markdown, "utf8"),
  sensitivity: "internal",
  retentionPolicy: "run-history",
});
const timelineSerialized = JSON.stringify(timeline);
for (const forbidden of [
  process.env.PROMPT,
  outputNode.output.markdown,
  "fake-default",
  "openai-compatible",
  "fake-m0",
  process.env.SECRET,
  "payload",
  "providerSnapshot",
  "agentExecutionId",
  "attemptId",
  "nodeRunId",
]) {
  if (timelineSerialized.includes(forbidden)) throw new Error("Run timeline redaction failed");
}
const serialized = JSON.stringify(body);
  for (const forbidden of [process.env.SECRET, "http://fake-provider", "CUSTOM_PROVIDER_KEY", "apiKeyEnv", "FAKE_PROVIDER_API_KEY", "fake-provider-local", "sessionId", "session_id", "PiSession"]) {
    if (serialized.includes(forbidden)) throw new Error("Run API redaction failed");
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
assert_equal "$(query "SELECT count(*) FROM execution_events WHERE workflow_run_id = '$run_b_id'")" "12"

artifact=$(query "
  SELECT json_build_object(
    'nodeId', node.node_id,
    'payload', event.payload
  )::text
  FROM execution_events event
  JOIN node_runs node ON node.id = event.node_run_id
  WHERE event.workflow_run_id = '$run_b_id' AND event.type = 'artifact.created'
")
ARTIFACT="$artifact" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const artifact = JSON.parse(process.env.ARTIFACT);
assert.deepStrictEqual(artifact, {
  nodeId: "result",
  payload: {
    source: { kind: "node.output", nodeId: "result" },
    sha256: createHash("sha256").update("Fake provider response", "utf8").digest("hex"),
    mediaType: "text/markdown",
    sizeBytes: Buffer.byteLength("Fake provider response", "utf8"),
    sensitivity: "internal",
    retentionPolicy: "run-history",
  },
});
NODE

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
const events = JSON.parse(process.env.EVENTS);
const check = (condition) => { if (!condition) throw new Error("event contract failed"); };
const expectedEvents = [
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
  { sequence: 11, type: "artifact.created", nodeId: "result" },
  { sequence: 12, type: "workflow.run.succeeded", nodeId: null },
];
check(JSON.stringify(events.map(({ sequence, type, nodeId }) => ({ sequence, type, nodeId }))) === JSON.stringify(expectedEvents));

for (const index of [0, 1, 11]) {
  check([events[index].nodeRunId, events[index].attemptId, events[index].agentExecutionId]
    .every((value) => value === null));
}
function assertAttemptPair(firstIndex, secondIndex) {
  const first = events[firstIndex];
  const second = events[secondIndex];
  check(typeof first.nodeRunId === "string");
  check(typeof first.attemptId === "string");
  check(first.agentExecutionId === null);
  check(second.nodeRunId === first.nodeRunId
    && second.attemptId === first.attemptId
    && second.agentExecutionId === null);
}
assertAttemptPair(2, 3);
assertAttemptPair(4, 7);
assertAttemptPair(8, 9);
check(events[10].nodeRunId === events[8].nodeRunId
  && events[10].attemptId === null
  && events[10].agentExecutionId === null);
for (const index of [5, 6]) {
  check(events[index].nodeRunId === events[4].nodeRunId
    && events[index].attemptId === events[4].attemptId);
  check(typeof events[index].agentExecutionId === "string");
}
check(events[5].agentExecutionId === events[6].agentExecutionId);
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
SNAPSHOTS="$snapshots" SECRET="$custom_provider_key" node --input-type=module <<'NODE'
import assert from "node:assert/strict";
const snapshots = JSON.parse(process.env.SNAPSHOTS);
const expected = {
  bindingAlias: "fake-default",
  effectiveProvider: "openai-compatible",
  effectiveModel: "fake-m0",
  parameters: { temperature: 0 },
};
assert.deepStrictEqual(snapshots.attempt, expected);
assert.deepStrictEqual(snapshots.execution, expected);
assert.deepStrictEqual(snapshots.attempt, snapshots.execution);
const serialized = JSON.stringify(snapshots);
for (const forbidden of [process.env.SECRET, "baseUrl", "apiKey", "apiKeyEnv", "CUSTOM_PROVIDER_KEY", "fake-provider-local", "sessionId", "session_id", "PiSession"]) {
  if (serialized.includes(forbidden)) throw new Error("provider snapshot redaction failed");
}
NODE

: >"$fixture_dir/database.jsonl"
for table in workflow_runs node_runs node_run_attempts agent_executions execution_events; do
  query "SELECT row_to_json(value)::text FROM (SELECT * FROM $table) value" >>"$fixture_dir/database.jsonl"
done
"${compose[@]}" logs --no-color >"$fixture_dir/services.log"
for forbidden in "$custom_provider_key" CUSTOM_PROVIDER_KEY apiKeyEnv "http://fake-provider:4010/v1"; do
  if grep -Fq "$forbidden" "$fixture_dir/database.jsonl" "$fixture_dir/services.log"; then
    echo "runtime evidence leaked provider credential material" >&2
    exit 1
  fi
done

if query "UPDATE execution_events SET type = type WHERE workflow_run_id = '$run_b_id'" >/dev/null 2>&1; then
  echo "execution events accepted UPDATE" >&2
  exit 1
fi
if query "DELETE FROM execution_events WHERE workflow_run_id = '$run_b_id'" >/dev/null 2>&1; then
  echo "execution events accepted DELETE" >&2
  exit 1
fi

if ! "${compose[@]}" run --rm migrate >"$fixture_dir/migration-replay.log" 2>&1; then
  cat "$fixture_dir/migration-replay.log" >&2
  echo "applied migrations failed to replay after an artifact Run" >&2
  exit 1
fi

if [[ -n "$evidence_dir" ]]; then
  printf '%s\n' "$events" >"$evidence_dir/event-exports/async-happy-events.json"
  "${compose[@]}" logs --no-color app worker fake-provider >"$evidence_dir/logs/async-happy-path.log"
  printf '{"runId":"%s","result":"PASS"}\n' "$run_b_id" >"$evidence_dir/test-results/async-happy-path.json"
  for forbidden in "$custom_provider_key" CUSTOM_PROVIDER_KEY apiKeyEnv "http://fake-provider:4010/v1"; do
    if grep -RFq "$forbidden" "$evidence_dir"; then
      echo "caller evidence leaked provider credential material" >&2
      exit 1
    fi
  done
fi

echo "M0-T05 async happy path passed for $run_b_id"
