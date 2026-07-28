import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * T6 (#116 #122): docker-compose.yml structural invariants.
 *
 * Like the Dockerfile tests in T5, these pin the D6 decisions so a careless
 * edit doesn't silently break `docker compose up`:
 *
 *   1. Single service `app` building from local Dockerfile.
 *   2. Port 4000 exposed (overridable via ${PORT:-4000}, prod default per map #133 D1).
 *   3. Named volume `workflow-data` mounted at `/app/data`
 *      (matches T5's `WORKFLOW_DATA_DIR=/app/data`).
 *   4. `restart: unless-stopped`.
 *   5. Healthcheck hitting `/health/live`.
 *   6. API key env vars passed through from host shell (NOT hardcoded).
 *   7. `PORT` env (not deprecated `SERVER_PORT`) drives the container port.
 *
 * A real `docker compose up` smoke test is out of scope for `node --test`
 * (needs Docker daemon) — left to CI / manual verification.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const COMPOSE_PATH = resolve(REPO_ROOT, "docker-compose.yml");

function readCompose() {
  if (!existsSync(COMPOSE_PATH)) {
    throw new Error(`docker-compose.yml not found at ${COMPOSE_PATH}`);
  }
  return readFileSync(COMPOSE_PATH, "utf8");
}

test("docker-compose.yml exists", () => {
  const content = readCompose();
  assert.ok(content.length > 0, "docker-compose.yml must not be empty");
});

test("defines a single service named app", () => {
  const content = readCompose();
  assert.match(content, /^services:\s*$/m, "must start with `services:`");
  assert.match(content, /^\s{2}app:\s*$/m, "must define a service named `app`");
});

test("app service builds from local Dockerfile (build: .)", () => {
  const content = readCompose();
  assert.match(content, /build:\s*\.\s*$/m, "app must build from local context (build: .)");
});

test("exposes port 4000 with default fallback (overridable via PORT env, map #133 D1)", () => {
  const content = readCompose();
  // `${PORT:-4000}:${PORT:-4000}` lets users override without editing the file.
  // Prod default is 4000 (map #133 D1); dev=:4001, E2E=:4099.
  assert.match(
    content,
    /\$\{PORT:-4000\}:\$\{PORT:-4000\}/,
    "ports must be `${PORT:-4000}:${PORT:-4000}` (overridable via shell PORT env, prod default 4000)"
  );
  assert.doesNotMatch(
    content,
    /\$\{PORT:-4001\}/,
    "must NOT use port 4001 as compose default — that's the dev port now, not prod"
  );
});

test("uses PORT env var (not deprecated SERVER_PORT) for the container port", () => {
  const content = readCompose();
  assert.match(
    content,
    /PORT:\s*\$\{PORT:-4000\}/,
    "must set `PORT: ${PORT:-4000}` in environment (map #133 D1 — PORT replaces SERVER_PORT)"
  );
  assert.doesNotMatch(
    content,
    /SERVER_PORT/,
    "must NOT reference SERVER_PORT — deprecated in favor of PORT (map #133 D1)"
  );
});

test("mounts named volume workflow-data at /app/data (matches T5 WORKFLOW_DATA_DIR)", () => {
  const content = readCompose();
  // T5 sets `ENV WORKFLOW_DATA_DIR=/app/data`. The compose volume MUST mount
  // at /app/data or data won't persist.
  assert.match(
    content,
    /workflow-data:\/app\/data/,
    "must mount `workflow-data:/app/data` (matches T5's WORKFLOW_DATA_DIR=/app/data)"
  );
});

test("declares workflow-data as a named volume", () => {
  const content = readCompose();
  assert.match(content, /^volumes:\s*$/m, "must declare a top-level `volumes:` section");
  assert.match(content, /^\s{2}workflow-data:\s*$/m, "must declare `workflow-data` named volume");
});

test("restart policy is unless-stopped", () => {
  const content = readCompose();
  assert.match(content, /restart:\s*unless-stopped/, "restart must be `unless-stopped`");
});

test("healthcheck hits /health/live", () => {
  const content = readCompose();
  assert.match(content, /\/health\/live/, "healthcheck must hit `/health/live`");
});

test("passes FAKE_PROVIDER_API_KEY through from host shell (NOT hardcoded)", () => {
  const content = readCompose();
  // `${VAR}` in compose pulls from the shell env where `docker compose up` runs.
  // This lets users set their provider key without editing the compose file.
  assert.match(
    content,
    /FAKE_PROVIDER_API_KEY:\s*\$\{FAKE_PROVIDER_API_KEY:-\}/,
    "must pass FAKE_PROVIDER_API_KEY from host shell (format: `FAKE_PROVIDER_API_KEY: ${FAKE_PROVIDER_API_KEY:-}`)"
  );
  // Must NOT have a hardcoded value.
  assert.doesNotMatch(
    content,
    /FAKE_PROVIDER_API_KEY:\s*["'][^$]/,
    "FAKE_PROVIDER_API_KEY must NOT be hardcoded — pull from shell env"
  );
});

test("does NOT mount .env file (secrets go via environment: passthrough)", () => {
  const content = readCompose();
  assert.doesNotMatch(
    content,
    /env_file:/,
    "must NOT use `env_file:` — secrets should be passed individually via `environment:` so they're explicit"
  );
});
