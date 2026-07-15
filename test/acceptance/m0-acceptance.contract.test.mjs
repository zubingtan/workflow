import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const blockingIds = [
  "M0-T01", "M0-T02", "M0-T03", "M0-T04", "M0-T05", "M0-T06", "M0-T07",
  "M0-T07E", "M0-T08", "M0-T09", "M0-T10", "M0-T11", "M0-T12",
];
const layers = [
  "npm test",
  "pnpm test:definition",
  "pnpm test:runtime-contract",
  "pnpm test:runtime",
  "pnpm test:failure:unit",
  "pnpm test:failure:pg",
  "test/bootstrap/system-bootstrap.sh",
  "test/runtime/async-happy-path.system.sh",
  "test/failure/failure-crash-restart.system.sh",
  "pnpm test:e2e",
];

function file(relativePath) {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `missing required file: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

function dryMake(target, env = process.env) {
  return spawnSync("make", ["--no-print-directory", "-n", target], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env,
  });
}

test("PR7 freezes exactly thirteen blocking M0 tests", () => {
  const acceptance = file("docs/plans/M0/acceptance.md");
  const actual = [...acceptance.matchAll(/^\|\s*(M0-T[0-9]+E?)\s*\|/gm)].map((match) => match[1]);
  assert.deepEqual(actual, blockingIds);
  assert.equal(new Set(actual).size, 13);
});

test("smoke-test targets an already-running stack and verify-m0 invokes every layer once", () => {
  const smoke = dryMake("smoke-test");
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.match(smoke.stdout, /\/api\/health\/ready/);
  assert.doesNotMatch(smoke.stdout, /docker\s+compose|\bmake\s+(?:up|down)\b/);

  const callerEvidence = "/tmp/pr7-caller-owned-evidence";
  const makeEnv = { ...process.env, EVIDENCE_DIR: callerEvidence };
  const support = dryMake("support-bundle", makeEnv);
  assert.equal(support.status, 0, support.stderr);
  assert.doesNotMatch(support.stdout, /placeholder|REWORK/i);
  assert.equal((support.stdout.match(/scripts\/acceptance\/support-bundle\.mjs/g) ?? []).length, 1);
  assert.match(support.stdout, new RegExp(callerEvidence));

  const verify = dryMake("verify-m0", makeEnv);
  assert.equal(verify.status, 0, verify.stderr);
  assert.doesNotMatch(verify.stdout, /placeholder|full M0 acceptance is not implemented/i);
  const configuredLayers = [...verify.stdout.matchAll(/^\s*--test\s+"([^"\r\n]+)"\s+\\\s*$/gm)]
    .map((match) => match[1]);
  assert.deepEqual(configuredLayers, layers, "every layer must be configured exactly once");
  for (const command of [
    "scripts/acceptance/generate-evidence.mjs",
    "scripts/acceptance/support-bundle.mjs",
    "scripts/acceptance/seal-evidence.mjs",
    "scripts/acceptance/validate-evidence.mjs",
  ]) {
    const lines = verify.stdout.split(/\r?\n/).filter((line) => line.includes(command));
    assert.equal(lines.length, 1, `${command} must run exactly once`);
    assert.match(lines[0], new RegExp(callerEvidence), `${command} must use caller EVIDENCE_DIR`);
  }
});

test("system harnesses preserve a caller-owned EVIDENCE_DIR even when execution fails", () => {
  const scripts = [
    "test/bootstrap/system-bootstrap.sh",
    "test/runtime/async-happy-path.system.sh",
    "test/failure/failure-crash-restart.system.sh",
  ];
  const directory = mkdtempSync(path.join(tmpdir(), "m0-evidence-contract-"));
  const marker = path.join(directory, "caller-owned.txt");
  const bin = path.join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "docker"), "#!/bin/sh\nexit 42\n");
  chmodSync(path.join(bin, "docker"), 0o755);
  writeFileSync(marker, "preserve");
  try {
    for (const script of scripts) {
      assert.match(file(script), /EVIDENCE_DIR/, `${script} must honor EVIDENCE_DIR`);
      spawnSync("bash", [script], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          EVIDENCE_DIR: directory,
          PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
        },
      });
      assert.equal(readFileSync(marker, "utf8"), "preserve", `${script} deleted caller evidence`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Playwright failure evidence retains traces", () => {
  const config = file("playwright.config.ts");
  assert.match(config, /trace:\s*["']retain-on-failure["']/);
});
