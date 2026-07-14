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
