#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-workflow-m0-bootstrap-${GITHUB_RUN_ID:-local}}"
fixture_dir=$(mktemp -d)
printf 'FAKE_PROVIDER_API_KEY=BOOTSTRAP_%s\n' "$(node -e 'process.stdout.write(crypto.randomUUID())')" >"$fixture_dir/worker.env"
export WORKFLOW_ENV_FILE="$fixture_dir/worker.env"
compose=(docker compose --env-file .env.example -f compose.yaml)
evidence_dir="${EVIDENCE_DIR:-}"
if [[ -n "$evidence_dir" ]]; then
  mkdir -p "$evidence_dir/logs" "$evidence_dir/test-results"
fi

cleanup() {
  status=$?
  if (( status != 0 )) && [[ -n "$evidence_dir" ]]; then
    "${compose[@]}" logs --no-color >"$evidence_dir/logs/bootstrap-system.log" 2>&1 || true
  fi
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  [[ -z "$fixture_dir" ]] || rm -rf "$fixture_dir"
  return "$status"
}
trap cleanup EXIT
"${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true

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

assert_multiarch() {
  local reference="$1"
  docker buildx imagetools inspect --raw "$reference" | node --input-type=module -e '
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    const manifest = JSON.parse(source);
    const platforms = new Set((manifest.manifests ?? []).map((entry) => `${entry.platform?.os}/${entry.platform?.architecture}`));
    if (!platforms.has("linux/amd64") || !platforms.has("linux/arm64")) process.exit(1);
  '
}

node_image=$(node -e 'const s=require("fs").readFileSync("Dockerfile","utf8");process.stdout.write(s.match(/^FROM\s+(\S+)/m)?.[1]??"")')
postgres_image=$(node -e 'const s=require("fs").readFileSync("compose.yaml","utf8");process.stdout.write(s.match(/^  postgres:\s*$[\s\S]*?^    image:\s*([^\s#]+)/m)?.[1]??"")')
assert_multiarch "$node_image"
assert_multiarch "$postgres_image"

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
container_records=""
for service in app worker postgres migrate fake-provider; do
  container_id=$("${compose[@]}" ps -a -q "$service")
  image_id=$(docker inspect --format '{{.Image}}' "$container_id")
  [[ "$container_id" =~ ^[a-f0-9]{64}$ ]]
  [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
  container_records+="${service},${container_id},${image_id}"$'\n'
done
if [[ -n "$evidence_dir" ]]; then
  CONTAINERS="$container_records" node -e '
    const records = Object.fromEntries(process.env.CONTAINERS.trim().split("\n").map((line) => {
      const [service, containerId, imageId] = line.split(",");
      return [service, { containerId, imageId }];
    }));
    require("fs").writeFileSync(process.argv[1], JSON.stringify({ services: records }, null, 2) + "\n");
  ' "$evidence_dir/test-results/bootstrap-compose.json"
fi
