import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const validator = path.join(root, "scripts/acceptance/validate-evidence.mjs");
const acceptance = path.join(root, "scripts/acceptance/m0-acceptance.mjs");
const generateEvidence = path.join(root, "scripts/acceptance/generate-evidence.mjs");
const sealEvidence = path.join(root, "scripts/acceptance/seal-evidence.mjs");
const supportBundle = path.join(root, "scripts/acceptance/support-bundle.mjs");
const ids = [
  "M0-T01", "M0-T02", "M0-T03", "M0-T04", "M0-T05", "M0-T06", "M0-T07",
  "M0-T07E", "M0-T08", "M0-T09", "M0-T10", "M0-T11", "M0-T12",
];

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function payloadFiles(directory, current = directory) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(current, entry.name);
    const relative = path.relative(directory, absolute);
    if (entry.isDirectory()) return payloadFiles(directory, absolute);
    return [relative];
  }).filter((relative) => !["MANIFEST", "SHA256SUMS"].includes(relative)).sort();
}

function seal(directory) {
  rmSync(path.join(directory, "MANIFEST"), { force: true });
  rmSync(path.join(directory, "SHA256SUMS"), { force: true });
  const payload = payloadFiles(directory);
  writeFileSync(path.join(directory, "MANIFEST"), `${JSON.stringify({ files: payload }, null, 2)}\n`);
  const checked = [...payload, "MANIFEST"];
  writeFileSync(path.join(directory, "SHA256SUMS"), checked
    .map((relative) => `${sha256(path.join(directory, relative))}  ${relative}`)
    .join("\n") + "\n");
}

function writeExecutable(file, source) {
  writeFileSync(file, source);
  chmodSync(file, 0o755);
}

function generatedEvidence() {
  const directory = mkdtempSync(path.join(tmpdir(), "m0-generated-evidence-"));
  const generated = spawnSync(process.execPath, [generateEvidence, "--evidence-dir", directory], {
    cwd: root,
    env: { ...process.env, ACCEPTANCE_GIT_SHA: "a".repeat(40) },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(generated.status, 0, generated.stderr);
  for (const id of ids) writeJson(path.join(directory, "test-results", `${id}.json`), { id, result: "PASS" });
  return directory;
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "m0-evidence-"));
  const matrix = ids.map((id, index) => ({
    Requirement: `M0-R${String(index + 1).padStart(2, "0")}`,
    Test: id,
    Evidence: `test-results/${id}.json`,
    Result: "PASS",
    Blocking: "Yes",
  }));
  writeFileSync(path.join(directory, "report.md"), "# M0 Acceptance\n\nResult: PASS\nDecision: GO\n");
  writeJson(path.join(directory, "report.json"), {
    milestone: "M0",
    result: "PASS",
    decision: "GO",
    gitSha: "a".repeat(40),
    documentVersion: "v0.4",
    workflowSchemaVersion: "oncall.workflow/v1alpha1",
    databaseMigrationVersion: "004_terminal_failures.sql",
    piAgentVersion: "0.73.1",
    blockingTests: { passed: 13, total: 13 },
    containerDigests: {
      app: `sha256:${"1".repeat(64)}`,
      postgres: `sha256:${"2".repeat(64)}`,
      fakeProvider: `sha256:${"3".repeat(64)}`,
    },
  });
  writeFileSync(path.join(directory, "requirement-matrix.csv"), [
    "Requirement,Test,Evidence,Result,Blocking",
    ...matrix.map((row) => Object.values(row).join(",")),
  ].join("\n") + "\n");
  writeJson(path.join(directory, "environment.json"), { gitSha: "a".repeat(40), os: "test", architecture: "test" });
  writeJson(path.join(directory, "versions.json"), { document: "v0.4", schema: "oncall.workflow/v1alpha1", migration: "004_terminal_failures.sql", pi: "0.73.1" });
  for (const row of matrix) writeJson(path.join(directory, row.Evidence), { id: row.Test, result: "PASS" });
  for (const [relative, value] of [
    ["event-exports/events.json", "[]\n"],
    ["logs/services.log", "redacted\n"],
    ["screenshots/m0.png", "image evidence\n"],
    ["traces/m0.trace", "trace evidence\n"],
    ["metrics/metrics.json", "{}\n"],
    ["support-bundle/diagnostics.json", "{}\n"],
  ]) {
    const absolute = path.join(directory, relative);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, value);
  }
  seal(directory);
  return directory;
}

function validate(directory, secret, expectedResult) {
  const args = [validator, "--bundle", directory, "--secret", secret];
  if (expectedResult) args.push("--expected-result", expectedResult);
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("complete 13/13 PASS and GO evidence validates with a closed manifest", () => {
  assert.equal(existsSync(validator) && statSync(validator).isFile(), true, "missing evidence validator");
  const directory = fixture();
  try {
    const report = JSON.parse(readFileSync(path.join(directory, "report.json"), "utf8"));
    assert.deepEqual(report.blockingTests, { passed: 13, total: 13 });
    assert.equal(report.result, "PASS");
    assert.equal(report.decision, "GO");
    assert.match(report.gitSha, /^[a-f0-9]{40}$/);
    assert.equal(report.documentVersion, "v0.4");
    assert.equal(report.workflowSchemaVersion, "oncall.workflow/v1alpha1");
    assert.equal(report.databaseMigrationVersion, "004_terminal_failures.sql");
    assert.equal(report.piAgentVersion, "0.73.1");
    assert.deepEqual(Object.keys(report.containerDigests).sort(), ["app", "fakeProvider", "postgres"]);
    assert.equal(validate(directory, "ABSENT_SECRET").status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("acceptance validation failure after sealing ends REWORK and retains a valid final seal", () => {
  const sentinel = "PR7_REWORK_SECRET_MUST_NOT_LEAK";
  const workspace = mkdtempSync(path.join(tmpdir(), "m0-post-seal-failure-"));
  const evidence = path.join(workspace, "evidence");
  const bin = path.join(workspace, "bin");
  const screenshotDirectory = path.join(root, "test-results");
  const screenshot = path.join(screenshotDirectory, `${path.basename(workspace)}.png`);
  mkdirSync(bin, { recursive: true });
  mkdirSync(screenshotDirectory, { recursive: true });
  writeFileSync(screenshot, "acceptance screenshot\n");
  writeExecutable(path.join(bin, "docker"), `#!/bin/sh\nprintf 'sha256:%064d\\n' 1\n`);

  const supportWrapper = path.join(workspace, "support-wrapper.mjs");
  writeFileSync(supportWrapper, `
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const evidence = process.argv[process.argv.indexOf("--evidence-dir") + 1];
const ids = ${JSON.stringify(ids)};
for (const id of ids) writeFileSync(path.join(evidence, "test-results", id + ".json"), JSON.stringify({ id, result: "PASS" }) + "\\n");
mkdirSync(path.join(evidence, "event-exports"), { recursive: true });
mkdirSync(path.join(evidence, "logs"), { recursive: true });
writeFileSync(path.join(evidence, "event-exports/events.json"), "[]\\n");
writeFileSync(path.join(evidence, "logs/services.log"), "redacted\\n");
const result = spawnSync(process.execPath, [${JSON.stringify(supportBundle)}, "--evidence-dir", evidence, "--result", "PASS"], { encoding: "utf8", env: process.env });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`);
  const validateWrapper = path.join(workspace, "validate-wrapper.mjs");
  const validationLog = path.join(workspace, "validation-invocations.jsonl");
  writeFileSync(validateWrapper, `
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import path from "node:path";
const evidence = process.argv[process.argv.indexOf("--bundle") + 1];
const expectedIndex = process.argv.indexOf("--expected-result");
const expectedResult = expectedIndex === -1 ? null : process.argv[expectedIndex + 1];
if (expectedResult !== "REWORK") appendFileSync(path.join(evidence, "logs/services.log"), "tampered after seal\\n");
const result = spawnSync(process.execPath, [${JSON.stringify(validator)}, ...process.argv.slice(2)], { encoding: "utf8", env: process.env });
appendFileSync(${JSON.stringify(validationLog)}, JSON.stringify({ expectedResult, status: result.status }) + "\\n");
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`);

  try {
    const args = [
      acceptance,
      "--evidence-dir", evidence,
      "--generate", generateEvidence,
      "--support", supportWrapper,
      "--seal", sealEvidence,
      "--validate", validateWrapper,
    ];
    for (let index = 0; index < 10; index += 1) args.push("--test", "true");
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: {
        ...process.env,
        ACCEPTANCE_GIT_SHA: "a".repeat(40),
        APP_PORT: "9",
        FAKE_PROVIDER_API_KEY: sentinel,
        PATH: `${bin}:${process.env.PATH}`,
      },
      encoding: "utf8",
      timeout: 30_000,
    });
    const report = JSON.parse(readFileSync(path.join(evidence, "report.json"), "utf8"));
    const invocations = existsSync(validationLog)
      ? readFileSync(validationLog, "utf8").trimEnd().split("\n").filter(Boolean).map(JSON.parse)
      : [];
    const reworkValidation = validate(evidence, sentinel, "REWORK");
    const defaultValidation = validate(evidence, sentinel);
    assert.deepEqual({
      acceptanceFailed: result.status !== 0,
      reportResult: report.result,
      reportDecision: report.decision,
      failurePathUsedProductionReworkMode: invocations.some((entry) => (
        entry.expectedResult === "REWORK" && entry.status === 0
      )),
      productionReworkValidationStatus: reworkValidation.status,
      defaultGoOnlyValidationRejected: defaultValidation.status !== 0,
      secretWasRedacted: `${result.stdout}${result.stderr}${reworkValidation.stdout}${reworkValidation.stderr}${defaultValidation.stdout}${defaultValidation.stderr}`
        .includes(sentinel) === false,
    }, {
      acceptanceFailed: true,
      reportResult: "REWORK",
      reportDecision: "REWORK",
      failurePathUsedProductionReworkMode: true,
      productionReworkValidationStatus: 0,
      defaultGoOnlyValidationRejected: true,
      secretWasRedacted: true,
    });
  } finally {
    rmSync(screenshot, { force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("support bundle blocks unavailable image inspection and records all real service digests on success", () => {
  const sentinel = "PR7_SUPPORT_SECRET_MUST_NOT_LEAK";
  const workspace = mkdtempSync(path.join(tmpdir(), "m0-support-digests-"));
  const failingBin = path.join(workspace, "failing-bin");
  const passingBin = path.join(workspace, "passing-bin");
  mkdirSync(failingBin, { recursive: true });
  mkdirSync(passingBin, { recursive: true });
  writeExecutable(path.join(failingBin, "docker"), "#!/bin/sh\nexit 42\n");
  writeExecutable(path.join(passingBin, "docker"), `#!/bin/sh\nprintf 'sha256:%064d\\n' 7\n`);
  const failedEvidence = generatedEvidence();
  const passedEvidence = generatedEvidence();

  try {
    const run = (directory, bin) => spawnSync(process.execPath, [
      supportBundle, "--evidence-dir", directory, "--result", "PASS",
    ], {
      cwd: root,
      env: {
        ...process.env,
        APP_PORT: "9",
        FAKE_PROVIDER_API_KEY: sentinel,
        PATH: `${bin}:${process.env.PATH}`,
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    const failed = run(failedEvidence, failingBin);
    const passed = run(passedEvidence, passingBin);
    const failedOutput = `${failed.stdout}${failed.stderr}`;
    const passedOutput = `${passed.stdout}${passed.stderr}`;
    const failedReport = JSON.parse(readFileSync(path.join(failedEvidence, "report.json"), "utf8"));
    const passedReport = JSON.parse(readFileSync(path.join(passedEvidence, "report.json"), "utf8"));

    assert.notEqual(failed.status, 0, "support bundle must fail when image inspection is unavailable");
    assert.equal(failedReport.result, "REWORK");
    assert.equal(failedReport.decision, "REWORK");
    assert.notEqual(failedReport.decision, "GO");
    assert.deepEqual(failedReport.containerDigests, {}, "failed inspection must not be replaced with source hashes");
    assert.equal(failedOutput.includes(sentinel), false, "failed support output leaked the secret sentinel");

    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(passedReport.result, "PASS");
    assert.equal(passedReport.decision, "GO");
    assert.deepEqual(
      Object.keys(passedReport.containerDigests).sort(),
      ["app", "fakeProvider", "migrate", "postgres", "worker"],
    );
    for (const digest of Object.values(passedReport.containerDigests)) assert.match(digest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(passedOutput.includes(sentinel), false, "successful support output leaked the secret sentinel");
  } finally {
    rmSync(failedEvidence, { recursive: true, force: true });
    rmSync(passedEvidence, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("tampering, incomplete evidence, invalid reports, and nested zip secrets are rejected safely", () => {
  assert.equal(existsSync(validator), true, "missing evidence validator");
  const sentinel = "PR7_SECRET_MUST_NOT_BE_PRINTED";
  const cases = [
    ["tampered payload", "ABSENT_SECRET_TAMPER", (directory) => {
      writeFileSync(path.join(directory, "logs/services.log"), "tampered\n");
    }],
    ["missing screenshot evidence", "ABSENT_SECRET_MISSING", (directory) => {
      rmSync(path.join(directory, "screenshots/m0.png"));
      seal(directory);
    }],
    ["12 of 13 report", "ABSENT_SECRET_REPORT", (directory) => {
      const reportPath = path.join(directory, "report.json");
      const report = JSON.parse(readFileSync(reportPath, "utf8"));
      report.blockingTests.passed = 12;
      writeJson(reportPath, report);
      seal(directory);
    }],
    ["duplicate matrix test ID", "ABSENT_SECRET_MATRIX", (directory) => {
      const matrixPath = path.join(directory, "requirement-matrix.csv");
      const rows = readFileSync(matrixPath, "utf8").trimEnd().split("\n");
      rows[8] = rows[7];
      writeFileSync(matrixPath, `${rows.join("\n")}\n`);
      seal(directory);
    }],
    ["nested zip secret", sentinel, (directory) => {
      const nested = mkdtempSync(path.join(tmpdir(), "m0-nested-secret-"));
      try {
        writeFileSync(path.join(nested, "secret.txt"), sentinel);
        const inner = path.join(nested, "inner.zip");
        assert.equal(spawnSync("zip", ["-q", inner, "secret.txt"], { cwd: nested }).status, 0);
        const outer = path.join(directory, "support-bundle/nested.zip");
        assert.equal(spawnSync("zip", ["-q", outer, "inner.zip"], { cwd: nested }).status, 0);
        seal(directory);
      } finally {
        rmSync(nested, { recursive: true, force: true });
      }
    }],
  ];

  for (const [label, secret, mutate] of cases) {
    const directory = fixture();
    try {
      const baseline = validate(directory, secret);
      assert.equal(baseline.status, 0, `${label}: valid baseline must not be rejected`);
      mutate(directory);
      const result = validate(directory, secret);
      assert.notEqual(result.status, 0, `${label}: validator accepted invalid evidence`);
      assert.equal(
        `${result.stdout}${result.stderr}`.includes(sentinel),
        false,
        `${label}: validator echoed the secret sentinel`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
