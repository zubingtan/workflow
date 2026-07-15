import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

function dockerignoreExcludes(content, relativePath) {
  let excluded = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const negated = line.startsWith("!");
    let pattern = (negated ? line.slice(1) : line).replace(/^\//, "");
    if (pattern.endsWith("/")) pattern += "**";

    let expression = "";
    for (let index = 0; index < pattern.length; index += 1) {
      if (pattern.slice(index, index + 3) === "**/") {
        expression += "(?:.*/)?";
        index += 2;
      } else if (pattern.slice(index, index + 2) === "**") {
        expression += ".*";
        index += 1;
      } else if (pattern[index] === "*") {
        expression += "[^/]*";
      } else if (pattern[index] === "?") {
        expression += "[^/]";
      } else {
        expression += pattern[index].replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
      }
    }

    const matcher = new RegExp(`^${expression}$`);
    const matches = pattern.includes("/")
      ? matcher.test(relativePath)
      : relativePath.split("/").some((segment) => matcher.test(segment));
    if (matches) excluded = !negated;
  }
  return excluded;
}

test("M0-T01 pins pnpm and Node runtime-compatible types exactly", () => {
  const packageJson = JSON.parse(requiredFile("package.json"));
  assert.equal(packageJson.packageManager, "pnpm@11.13.0");
  assert.equal(packageJson.engines?.node, "22.x");
  assert.equal(packageJson.devDependencies?.["@types/node"], "22.20.1");
});

test("M0-T01 pins every external container image by immutable digest", () => {
  const dockerfile = requiredFile("Dockerfile");
  const externalFrom = [...dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+\S+)?$/gmi)]
    .map((match) => match[1])
    .filter((reference) => !["base", "dependencies", "builder", "runner"].includes(reference));
  assert.ok(externalFrom.length > 0, "Dockerfile must declare an external base image");
  for (const reference of externalFrom) {
    assert.match(reference, /^[^@\s]+@sha256:[a-f0-9]{64}$/u, `unpinned Dockerfile FROM: ${reference}`);
  }
  assert.equal(new Set(externalFrom).size, 1, "all Node build stages must use the same pinned base image");

  const compose = requiredFile("compose.yaml");
  const blocks = Object.fromEntries(
    ["app", "worker", "postgres", "migrate", "fake-provider"]
      .map((name) => [name, serviceBlock(compose, name)]),
  );
  const image = (name) => blocks[name].match(/^\s+image:\s*["']?([^\s"']+)/m)?.[1];
  assert.match(image("postgres") ?? "", /^postgres:[^@\s]+@sha256:[a-f0-9]{64}$/u);
  assert.equal(image("migrate"), image("postgres"), "migrate must use the exact PostgreSQL digest");
  for (const name of ["app", "worker", "fake-provider"]) {
    assert.equal(image(name), "workflow-m0:${WORKFLOW_IMAGE_TAG:-local}");
  }
});

test("M0-T01 keeps local environment state and build metadata out of images", () => {
  const dockerignore = requiredFile(".dockerignore");
  const actual = Object.fromEntries(
    [".env", ".env.local", ".env.test.local", "build.tsbuildinfo", "src/build.tsbuildinfo", ".env.example"]
      .map((relativePath) => [relativePath, dockerignoreExcludes(dockerignore, relativePath)]),
  );
  assert.deepEqual(actual, {
    ".env": true,
    ".env.local": true,
    ".env.test.local": true,
    "build.tsbuildinfo": true,
    "src/build.tsbuildinfo": true,
    ".env.example": false,
  });
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

  const appPorts = yamlBlock(blocks.app, "ports", 4);
  const shortBindings = appPorts
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-"));
  const mappingHostIps = [...appPorts.matchAll(/^\s+host_ip:\s*["']?([^\s"']+)/gm)]
    .map((match) => match[1]);
  const appPortsAreLoopbackOnly = mappingHostIps.length > 0
    ? mappingHostIps.length === shortBindings.length
      && mappingHostIps.every((hostIp) => hostIp === "127.0.0.1")
    : shortBindings.length > 0 && shortBindings.every((binding) => /127\.0\.0\.1:/.test(binding));
  assert.deepEqual(
    {
      appPortsAreLoopbackOnly,
      fakeProviderPublishesHostPorts: /^\s+ports:\s*$/m.test(blocks["fake-provider"]),
    },
    {
      appPortsAreLoopbackOnly: true,
      fakeProviderPublishesHostPorts: false,
    },
  );

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

test("M0-T01/T02 expose the required Make targets with a real verify-m0 gate", () => {
  const makefile = requiredFile("Makefile");
  for (const target of ["setup", "doctor", "up", "down", "logs", "smoke-test", "verify-m0"]) {
    assert.match(makefile, new RegExp(`^${target}:`, "m"), `missing make target: ${target}`);
  }
  assert.doesNotMatch(
    makefile,
    /verify-m0:[\s\S]{0,200}(?:placeholder|full M0 acceptance is not implemented)/i,
  );
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

test("system harness failure diagnostics never interpolate provider values or serialized payloads", () => {
  const asyncHarness = requiredFile("test/runtime/async-happy-path.system.sh");
  assert.doesNotMatch(asyncHarness, /throw new Error\(`[^`]*\$\{/u);
  assert.doesNotMatch(asyncHarness, /(?:leaked|expected)[^\n]*(?:\$\{?forbidden|\$1|\$2)/u);
  assert.doesNotMatch(asyncHarness, /if \(\( status != 0 \)\)[\s\S]{0,180}logs --no-color \|\| true/u);

  for (const relative of [
    "test/bootstrap/system-bootstrap.sh",
    "test/failure/failure-crash-restart.system.sh",
  ]) {
    const harness = requiredFile(relative);
    assert.doesNotMatch(harness, /(?:echo|throw new Error)[^\n]*(?:custom_provider_key|CUSTOM_PROVIDER_KEY|SECRET)/u);
  }
});

test("every real Compose test harness isolates the worker env file explicitly", () => {
  const bootstrap = requiredFile("test/bootstrap/system-bootstrap.sh");
  const createIndex = bootstrap.indexOf("fixture_dir=$(mktemp -d)");
  const exportIndex = bootstrap.indexOf("export WORKFLOW_ENV_FILE=");
  const composeIndex = bootstrap.indexOf("compose=(docker compose");
  assert.ok(createIndex !== -1 && createIndex < exportIndex && exportIndex < composeIndex);
  assert.doesNotMatch(bootstrap, /^cleanup \|\| true$/m, "initial cleanup must not delete the worker env fixture");
  assert.match(requiredFile("test/runtime/async-happy-path.system.sh"), /^WORKFLOW_ENV_FILE=\$fixture_dir\/worker\.env$/m);
  assert.match(requiredFile("test/failure/failure-crash-restart.system.sh"), /^WORKFLOW_ENV_FILE=\$fixture_dir\/worker\.env$/m);
  assert.match(requiredFile("test/e2e/fixtures/compose-stack.ts"), /WORKFLOW_ENV_FILE:\s*workerEnvFile/);
  for (const relative of [
    "test/runtime/async-happy-path.system.sh",
    "test/failure/failure-crash-restart.system.sh",
  ]) {
    assert.doesNotMatch(requiredFile(relative), /^\s+env_file:\s*$/m, `${relative} duplicates worker env_file`);
  }

  const directory = mkdtempSync(path.join(tmpdir(), "workflow-bootstrap-env-order-"));
  try {
    const bin = path.join(directory, "bin");
    const log = path.join(directory, "docker-calls.log");
    mkdirSync(bin);
    const docker = path.join(bin, "docker");
    writeFileSync(docker, `#!/bin/sh
if [ -z "\${WORKFLOW_ENV_FILE:-}" ] || [ ! -f "$WORKFLOW_ENV_FILE" ]; then
  printf 'unsafe\\n' >>"$DOCKER_CALL_LOG"
  exit 91
fi
printf 'safe|%s\\n' "$WORKFLOW_ENV_FILE" >>"$DOCKER_CALL_LOG"
exit 42
`);
    chmodSync(docker, 0o755);
    const result = spawnSync("bash", ["test/bootstrap/system-bootstrap.sh"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        HOME: process.env.HOME ?? tmpdir(),
        PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
        DOCKER_CALL_LOG: log,
        COMPOSE_PROJECT_NAME: `bootstrap-env-order-${process.pid}`,
      },
    });
    assert.notEqual(result.status, 0, "ordering probe must stop before running a real stack");
    const calls = readFileSync(log, "utf8").trimEnd().split("\n");
    assert.ok(calls.length >= 2, "probe must cover initial cleanup and failure trap");
    assert.ok(calls.every((line) => line.startsWith("safe|")), "a Docker call ran before the safe worker env existed");
    assert.equal(existsSync(calls[0].slice("safe|".length)), false, "failure trap did not remove the worker env fixture");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
