import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  argument, assertRegularFile, blockingTests, filesUnder, readJson, requireArgument, sha256File,
} from "./evidence-utils.mjs";

const bundle = requireArgument("--bundle");
const expectedResult = argument("--expected-result", "PASS");
const secretIndex = process.argv.indexOf("--secret");
const secret = secretIndex === -1 ? "" : (process.argv[secretIndex + 1] ?? "");

function fail(message) {
  console.error(`Evidence validation failed: ${message}`);
  process.exit(1);
}

function scanBuffer(buffer, label, depth = 0) {
  if (secret && buffer.includes(Buffer.from(secret))) fail(`secret material found in ${label}`);
  if (depth >= 8 || !label.toLowerCase().endsWith(".zip")) return;
  const temporary = mkdtempSync(path.join(tmpdir(), "m0-evidence-zip-"));
  const archive = path.join(temporary, "archive.zip");
  try {
    writeFileSync(archive, buffer);
    const listing = spawnSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (listing.status !== 0) fail(`invalid nested zip in ${label}`);
    for (const entry of listing.stdout.split(/\r?\n/u).filter(Boolean)) {
      if (entry.endsWith("/")) continue;
      const extracted = spawnSync("unzip", ["-p", archive, entry], { maxBuffer: 64 * 1024 * 1024 });
      if (extracted.status !== 0) fail(`cannot inspect nested zip entry in ${label}`);
      scanBuffer(extracted.stdout, `${label}/${entry}`, depth + 1);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  if (!["PASS", "REWORK"].includes(expectedResult)) fail("invalid expected result mode");
  for (const file of ["MANIFEST", "SHA256SUMS", "report.md", "report.json", "requirement-matrix.csv", "environment.json", "versions.json"]) {
    assertRegularFile(path.join(bundle, file), file);
  }
  const manifest = readJson(path.join(bundle, "MANIFEST"));
  if (!Array.isArray(manifest.files) || manifest.files.some((file) => typeof file !== "string")) fail("invalid MANIFEST");
  const actual = filesUnder(bundle).filter((file) => !["MANIFEST", "SHA256SUMS"].includes(file));
  if (JSON.stringify(manifest.files) !== JSON.stringify(actual)) fail("MANIFEST is not closed over bundle files");

  const checksumLines = readFileSync(path.join(bundle, "SHA256SUMS"), "utf8").trimEnd().split("\n");
  const expectedChecked = [...actual, "MANIFEST"];
  if (checksumLines.length !== expectedChecked.length) fail("SHA256SUMS entry count mismatch");
  for (const [index, file] of expectedChecked.entries()) {
    const expected = `${sha256File(path.join(bundle, file))}  ${file}`;
    if (checksumLines[index] !== expected) fail(`checksum mismatch for ${file}`);
  }

  for (const directory of ["test-results", "event-exports", "logs", "screenshots", "traces", "metrics", "support-bundle"]) {
    if (!actual.some((file) => file.startsWith(`${directory}/`))) fail(`missing ${directory} evidence`);
  }

  const report = readJson(path.join(bundle, "report.json"));
  const expectedDecision = expectedResult === "PASS" ? "GO" : "REWORK";
  if (report.milestone !== "M0" || report.result !== expectedResult || report.decision !== expectedDecision) {
    fail(`report is not M0 ${expectedResult}/${expectedDecision}`);
  }
  if (!/^[a-f0-9]{40}$/u.test(report.gitSha)) fail("invalid report Git SHA");
  if (report.documentVersion !== "v0.4" || report.workflowSchemaVersion !== "oncall.workflow/v1alpha1") fail("invalid document or schema version");
  if (report.databaseMigrationVersion !== "004_terminal_failures.sql" || report.piAgentVersion !== "0.73.1") fail("invalid migration or Pi version");
  if (!Number.isInteger(report.blockingTests?.passed) || report.blockingTests.total !== 13 ||
      report.blockingTests.passed < 0 || report.blockingTests.passed > 13) fail("invalid blocking test totals");
  if (expectedResult === "PASS" && report.blockingTests.passed !== 13) fail("report does not prove 13/13");
  const digestKeys = Object.keys(report.containerDigests).sort();
  const acceptedDigestSets = [
    ["app", "fakeProvider", "postgres"],
    ["app", "fakeProvider", "migrate", "postgres", "worker"],
  ];
  const digestSetAccepted = acceptedDigestSets.some((keys) => JSON.stringify(keys) === JSON.stringify(digestKeys));
  if (!digestSetAccepted && !(expectedResult === "REWORK" && digestKeys.length === 0)) fail("container digest set mismatch");
  if (Object.values(report.containerDigests).some((value) => !/^sha256:[a-f0-9]{64}$/u.test(value))) fail("invalid container digest");
  if (readJson(path.join(bundle, "environment.json")).gitSha !== report.gitSha) fail("environment Git SHA mismatch");
  const versions = readJson(path.join(bundle, "versions.json"));
  if (versions.document !== report.documentVersion || versions.schema !== report.workflowSchemaVersion ||
      versions.migration !== report.databaseMigrationVersion || versions.pi !== report.piAgentVersion) {
    fail("versions evidence does not match report");
  }

  const matrix = readFileSync(path.join(bundle, "requirement-matrix.csv"), "utf8").trimEnd().split(/\r?\n/u);
  if (matrix.shift() !== "Requirement,Test,Evidence,Result,Blocking") fail("invalid requirement matrix header");
  const rows = matrix.map((line) => {
    const [Requirement, Test, Evidence, Result, Blocking] = line.split(",");
    return { Requirement, Test, Evidence, Result, Blocking };
  });
  if (JSON.stringify(rows.map((row) => row.Test)) !== JSON.stringify(blockingTests)) fail("requirement matrix test IDs mismatch");
  if (new Set(rows.map((row) => row.Test)).size !== blockingTests.length) fail("duplicate requirement matrix test ID");
  let matrixPassed = 0;
  for (const [index, row] of rows.entries()) {
    if (row.Requirement !== `M0-R${String(index + 1).padStart(2, "0")}` || !["PASS", "FAIL"].includes(row.Result) || row.Blocking !== "Yes") fail("invalid requirement matrix row");
    if (expectedResult === "PASS" && row.Result !== "PASS") fail("PASS report contains a failed requirement");
    assertRegularFile(path.join(bundle, row.Evidence), row.Evidence);
    const evidence = readJson(path.join(bundle, row.Evidence));
    if (evidence.id !== row.Test || evidence.result !== row.Result) fail(`invalid evidence for ${row.Test}`);
    if (row.Result === "PASS") matrixPassed += 1;
  }
  if (matrixPassed !== report.blockingTests.passed) fail("matrix and report pass counts differ");
  for (const file of actual) scanBuffer(readFileSync(path.join(bundle, file)), file);
  console.log(`PASS: ${expectedResult} evidence bundle is complete, immutable, and secret-safe`);
} catch (error) {
  fail(error instanceof Error ? error.message : "unknown validation error");
}
