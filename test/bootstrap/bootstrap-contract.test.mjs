import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function requiredFile(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `missing required file: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

function yamlBlock(content, name, indent = 0) {
  const prefix = " ".repeat(indent);
  const match = new RegExp(`^${prefix}${name}:\\s*$`, "m").exec(content);
  assert.ok(match, `missing YAML block: ${name}`);
  const rest = content.slice(match.index + match[0].length);
  const next = rest.search(new RegExp(`^${prefix}\\S`, "m"));
  return next === -1 ? rest : rest.slice(0, next);
}

function serviceBlock(compose, name) {
  return yamlBlock(yamlBlock(compose, "services"), name, 2);
}

test("M0-T01 pins pnpm 11.13.0 and Node 22", () => {
  const packageJson = JSON.parse(requiredFile("package.json"));
  assert.equal(packageJson.packageManager, "pnpm@11.13.0");
  assert.equal(packageJson.engines?.node, "22.x");
});

test("M0-T01 Compose declares the complete healthy bootstrap topology", () => {
  const compose = requiredFile("compose.yaml");
  const services = ["app", "worker", "postgres", "migrate", "fake-provider"];
  const blocks = Object.fromEntries(services.map((name) => [name, serviceBlock(compose, name)]));

  for (const name of ["app", "worker", "postgres", "fake-provider"]) {
    assert.match(blocks[name], /^\s+healthcheck:\s*$/m, `${name} needs a healthcheck`);
  }
  assert.match(blocks.postgres, /pg_isready/, "postgres healthcheck must use pg_isready");
  assert.match(blocks.app, /\/api\/health\/ready/, "app healthcheck must use readiness");
  assert.match(blocks["fake-provider"], /\/health\/live/, "fake provider needs liveness");

  const appImage = blocks.app.match(/^\s+image:\s*["']?([^\s"']+)/m)?.[1];
  const workerImage = blocks.worker.match(/^\s+image:\s*["']?([^\s"']+)/m)?.[1];
  assert.ok(appImage, "app must name its built image");
  assert.equal(workerImage, appImage, "app and worker must use the same image");

  assert.match(blocks.migrate, /restart:\s*["']?no["']?/);
  assert.match(blocks.migrate, /condition:\s*service_healthy/);
  for (const name of ["app", "worker"]) {
    assert.match(blocks[name], /condition:\s*service_completed_successfully/);
  }

  const volumes = yamlBlock(compose, "volumes");
  const mount = blocks.postgres.match(/^\s+-\s*([A-Za-z0-9_.-]+):\/var\/lib\/postgresql\/data\s*$/m)?.[1];
  assert.ok(mount, "postgres must use a named data volume");
  assert.match(volumes, new RegExp(`^  ${mount}:`, "m"));

  for (const line of compose.split(/\r?\n/)) {
    if (!/(PASSWORD|SECRET|API_KEY|TOKEN)\s*[:=]/i.test(line)) continue;
    assert.match(line, /\$\{[A-Z][A-Z0-9_]*\}/, `secret must be injected without a default: ${line.trim()}`);
  }
  assert.doesNotMatch(compose, /\bsk-[A-Za-z0-9_-]+/);
});

test("M0-T01 provides environment and non-secret provider-binding examples", () => {
  const env = requiredFile(".env.example");
  for (const key of ["DATABASE_URL", "PROVIDER_BINDINGS_FILE", "FAKE_PROVIDER_API_KEY"]) {
    assert.match(env, new RegExp(`^${key}=.+$`, "m"), `.env.example must define ${key}`);
  }
  assert.doesNotMatch(env, /\bsk-[A-Za-z0-9_-]+/);

  const raw = requiredFile("config/provider-bindings.example.json");
  assert.doesNotThrow(() => JSON.parse(raw));
  assert.match(raw, /fake-default/i, "example needs a stable binding alias");
  assert.match(raw, /openai-compatible/i);
  assert.match(raw, /http:\/\/fake-provider:/i);
  assert.match(raw, /FAKE_PROVIDER_API_KEY/);
  assert.match(raw, /fake-m0/i);
  assert.doesNotMatch(raw, /"(?:apiKey|secret|token)"\s*:/i, "binding stores env names, never credentials");
});

test("M0-T01/T02 expose the required Make targets while verify-m0 stays REWORK", () => {
  const makefile = requiredFile("Makefile");
  for (const target of ["setup", "doctor", "up", "down", "logs", "smoke-test", "verify-m0"]) {
    assert.match(makefile, new RegExp(`^${target}:`, "m"), `missing make target: ${target}`);
  }
  assert.match(makefile, /verify-m0:[\s\S]*REWORK/i);
});

test("M0-T01 includes an executable clean-Compose system harness", () => {
  const relativePath = "test/bootstrap/system-bootstrap.sh";
  const script = requiredFile(relativePath);
  assert.notEqual(statSync(path.join(root, relativePath)).mode & 0o111, 0, "system harness must be executable");
  assert.match(script, /docker compose/);
  assert.match(script, /\bbuild\b/);
  assert.match(script, /\bup\b/);
  assert.match(script, /service_healthy|\.State\.Health\.Status/);
  assert.match(script, /migrate/);
  assert.match(script, /seed|agent_definitions|workflows/);
  assert.match(script, /down[^\n]*(?:--volumes|-v)/);
});
