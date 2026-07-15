import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const doctor = path.join(root, "scripts/doctor.mjs");

function runDoctor(env) {
  return spawnSync(process.execPath, [doctor], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: { HOME: process.env.HOME ?? tmpdir(), NO_COLOR: "1", ...env },
  });
}

function output(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function writeBinding(directory, apiKeyEnv = "FAKE_PROVIDER_API_KEY") {
  const bindingPath = path.join(directory, "bindings.json");
  writeFileSync(bindingPath, JSON.stringify({
    bindings: {
      "fake-default": {
        provider: "openai-compatible",
        baseUrl: "http://fake-provider:4010/v1",
        apiKeyEnv,
        model: "fake-m0",
      },
    },
  }));
  return bindingPath;
}

test("M0-T02 missing provider binding exits nonzero with an actionable diagnosis", () => {
  const sentinel = "doctor-must-never-echo-this-secret-value";
  const result = runDoctor({ PATH: process.env.PATH ?? "", UNRELATED_SECRET: sentinel });
  const text = output(result);
  assert.notEqual(result.status, 0);
  assert.match(text, /provider[ _-]?binding/i);
  assert.match(text, /PROVIDER_BINDINGS_FILE|missing|configure/i);
  assert.doesNotMatch(text, new RegExp(sentinel));
});

test("M0-T02 missing binding credential names the env key without leaking values", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "workflow-doctor-"));
  const sentinel = `DOCTOR_SECRET_${randomUUID()}`;
  try {
    const result = runDoctor({
      PATH: process.env.PATH ?? "",
      PROVIDER_BINDINGS_FILE: writeBinding(directory, "CUSTOM_PROVIDER_KEY"),
      DATABASE_URL: "postgres://workflow:redacted-value@postgres:5432/workflow",
      UNRELATED_SECRET: sentinel,
    });
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /CUSTOM_PROVIDER_KEY/);
    assert.match(text, /missing|set|configure/i);
    assert.doesNotMatch(text, /redacted-value/);
    assert.doesNotMatch(text, new RegExp(sentinel));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("M0-T02 valid fake-provider config passes with injected command probes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "workflow-doctor-"));
  try {
    const bin = path.join(directory, "bin");
    mkdirSync(bin);
    const probes = {
      node: "#!/bin/sh\necho v22.99.0\n",
      pnpm: "#!/bin/sh\necho 11.13.0\n",
      docker: "#!/bin/sh\nif [ \"$1\" = compose ]; then echo 'Docker Compose version v2.99.0'; else echo 'Docker version 27.0.0'; fi\n",
    };
    for (const [name, script] of Object.entries(probes)) {
      const file = path.join(bin, name);
      writeFileSync(file, script);
      chmodSync(file, 0o755);
    }
    const secret = `DOCTOR_SECRET_${randomUUID()}`;
    const result = runDoctor({
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PROVIDER_BINDINGS_FILE: writeBinding(directory, "CUSTOM_PROVIDER_KEY"),
      DATABASE_URL: "postgres://workflow:workflow@postgres:5432/workflow",
      CUSTOM_PROVIDER_KEY: secret,
    });
    const text = output(result);
    assert.equal(result.status, 0, text);
    assert.match(text, /PASS|ready|ok/i);
    assert.doesNotMatch(text, new RegExp(secret));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("M0-T02 requires Docker Compose 2.24.0 or newer without echoing credentials", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "workflow-doctor-compose-version-"));
  try {
    const bin = path.join(directory, "bin");
    mkdirSync(bin);
    for (const [name, script] of Object.entries({
      node: "#!/bin/sh\necho v22.99.0\n",
      pnpm: "#!/bin/sh\necho 11.13.0\n",
      docker: "#!/bin/sh\nif [ \"$1\" = compose ]; then echo \"Docker Compose version $DOCKER_COMPOSE_VERSION\"; else echo 'Docker version 27.0.0'; fi\n",
    })) {
      const file = path.join(bin, name);
      writeFileSync(file, script);
      chmodSync(file, 0o755);
    }
    const secret = `DOCTOR_VERSION_SECRET_${randomUUID()}`;
    const baseEnv = {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PROVIDER_BINDINGS_FILE: writeBinding(directory, "CUSTOM_PROVIDER_KEY"),
      DATABASE_URL: "postgres://workflow:workflow@postgres:5432/workflow",
      CUSTOM_PROVIDER_KEY: secret,
    };
    const unsupported = runDoctor({ ...baseEnv, DOCKER_COMPOSE_VERSION: "v2.23.9" });
    assert.notEqual(unsupported.status, 0);
    assert.match(output(unsupported), /compose|2\.24|version/i);
    assert.doesNotMatch(output(unsupported), new RegExp(secret));

    const minimum = runDoctor({ ...baseEnv, DOCKER_COMPOSE_VERSION: "v2.24.0" });
    assert.equal(minimum.status, 0, output(minimum));
    assert.doesNotMatch(output(minimum), new RegExp(secret));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
