#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-workflow-m0-bootstrap-${GITHUB_RUN_ID:-local}}"
compose=(docker compose --env-file .env.example -f compose.yaml)

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans
}
trap cleanup EXIT
cleanup || true

wait_healthy() {
  local service="$1" container status
  for _ in $(seq 1 60); do
    container="$("${compose[@]}" ps -q "$service")"
    if [[ -n "$container" ]]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
      [[ "$status" == healthy ]] && return 0
      [[ "$status" == unhealthy ]] && break
    fi
    sleep 1
  done
  "${compose[@]}" ps
  "${compose[@]}" logs "$service"
  return 1
}

"${compose[@]}" build
"${compose[@]}" up -d postgres fake-provider
wait_healthy postgres
wait_healthy fake-provider

"${compose[@]}" up --no-deps migrate
"${compose[@]}" run --rm --no-deps migrate

"${compose[@]}" exec -T postgres sh -eu -c '
  workflow_count="$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "SELECT COUNT(*) FROM workflows")"
  agent_definition_count="$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "SELECT COUNT(*) FROM agent_definitions")"
  workflow_version_count="$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "SELECT COUNT(*) FROM workflow_definition_versions")"
  agent_version_count="$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -Atc "SELECT COUNT(*) FROM agent_definition_versions")"
  test "$workflow_count" -ge 1
  test "$agent_definition_count" -ge 1
  test "$workflow_version_count" -ge 1
  test "$agent_version_count" -ge 1
'

"${compose[@]}" up -d app worker
wait_healthy app
wait_healthy worker

"${compose[@]}" ps
