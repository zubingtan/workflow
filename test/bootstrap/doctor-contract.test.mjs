import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function writeBinding(directory) {
  const bindingPath = path.join(directory, "bindings.json");
  writeFileSync(bindingPath, JSON.stringify({
    bindings: {
      "fake-default": {
        provider: "openai-compatible",
        baseUrl: "http://fake-provider:4010/v1",
        apiKeyEnv: "FAKE_PROVIDER_API_KEY",
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
  try {
    const result = runDoctor({
      PATH: process.env.PATH ?? "",
      PROVIDER_BINDINGS_FILE: writeBinding(directory),
      DATABASE_URL: "postgres://workflow:redacted-value@postgres:5432/workflow",
    });
    const text = output(result);
    assert.notEqual(result.status, 0);
    assert.match(text, /FAKE_PROVIDER_API_KEY/);
    assert.match(text, /missing|set|configure/i);
    assert.doesNotMatch(text, /redacted-value/);
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
    const secret = "fake-provider-doctor-secret";
    const result = runDoctor({
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      PROVIDER_BINDINGS_FILE: writeBinding(directory),
      DATABASE_URL: "postgres://workflow:workflow@postgres:5432/workflow",
      FAKE_PROVIDER_API_KEY: secret,
    });
    const text = output(result);
    assert.equal(result.status, 0, text);
    assert.match(text, /PASS|ready|ok/i);
    assert.doesNotMatch(text, new RegExp(secret));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
