import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { argument, blockingTests, readJson, requireArgument, writeJson } from "./evidence-utils.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const evidence = requireArgument("--evidence-dir");
const generate = argument("--generate");
const support = argument("--support");
const seal = argument("--seal");
const validate = argument("--validate");
const commands = [];
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] === "--test") commands.push(process.argv[index + 1]);
}
if (![generate, support, seal, validate].every(Boolean) || commands.length !== 7) throw new Error("Invalid M0 acceptance command configuration");

const env = {
  ...process.env,
  EVIDENCE_DIR: evidence,
  FAKE_PROVIDER_API_KEY: process.env.FAKE_PROVIDER_API_KEY ?? `M0_ACCEPTANCE_${randomUUID()}`,
};
let failed = false;
const layerMetrics = [];

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  return result.status === 0;
}

if (!runNode(generate, ["--evidence-dir", evidence])) process.exit(1);

const mappings = new Map([
  ["pnpm test:fast", ["M0-T02"]],
  ["pnpm test:integration", ["M0-T03", "M0-T04", "M0-T05", "M0-T06", "M0-T07", "M0-T07E", "M0-T08", "M0-T09", "M0-T11"]],
  ["pnpm test:release-tools", ["M0-T12"]],
  ["test/bootstrap/system-bootstrap.sh", ["M0-T01"]],
  ["test/runtime/async-happy-path.system.sh", ["M0-T05"]],
  ["test/failure/failure-crash-restart.system.sh", ["M0-T06", "M0-T07", "M0-T07E", "M0-T08", "M0-T09", "M0-T11"]],
  ["pnpm test:e2e", ["M0-T10"]],
]);

for (const [index, command] of commands.entries()) {
  const label = `layer-${String(index + 1).padStart(2, "0")}`;
  const commandEnv = { ...env };
  const needsDatabase = command === "pnpm test:integration";
  if (needsDatabase) commandEnv.DATABASE_URL = process.env.ACCEPTANCE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  else delete commandEnv.DATABASE_URL;
  const startedAt = Date.now();
  const result = needsDatabase && commandEnv.DATABASE_URL === ""
    ? { status: 1, stdout: "", stderr: "ACCEPTANCE_DATABASE_URL is required for PostgreSQL integration tests\n" }
    : spawnSync(command, { cwd: root, env: commandEnv, encoding: "utf8", shell: true, maxBuffer: 64 * 1024 * 1024 });
  layerMetrics.push({ command, durationMs: Date.now() - startedAt, result: result.status === 0 ? "PASS" : "FAIL" });
  writeFileSync(path.join(evidence, "test-results", `${label}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  const pass = result.status === 0;
  if (!pass) failed = true;
  for (const id of mappings.get(command) ?? []) {
    writeJson(path.join(evidence, "test-results", `${id}.json`), { id, result: pass ? "PASS" : "FAIL", command });
  }
}

function copyMatching(source, destination, predicate, current = source) {
  if (!existsSync(current)) return 0;
  let copied = 0;
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) copied += copyMatching(source, destination, predicate, absolute);
    else if (predicate(entry.name)) {
      mkdirSync(destination, { recursive: true });
      cpSync(absolute, path.join(destination, path.relative(source, absolute).replaceAll(path.sep, "__")));
      copied += 1;
    }
  }
  return copied;
}

const screenshotCount = copyMatching(path.join(root, "test-results"), path.join(evidence, "screenshots"), (name) => name.endsWith(".png"));
copyMatching(path.join(root, "test-results"), path.join(evidence, "traces"), (name) => name === "trace.zip" || name.endsWith(".webm"));
writeJson(path.join(evidence, "traces", "index.json"), { policy: "retain-on-failure", retainedFiles: failed ? "see directory" : 0 });
if (screenshotCount === 0) failed = true;

for (const id of blockingTests) {
  const file = path.join(evidence, "test-results", `${id}.json`);
  if (!existsSync(file)) writeJson(file, { id, result: "FAIL", reason: "owning acceptance layer did not complete" });
}
writeJson(path.join(evidence, "test-results", "M0-T12.json"), { id: "M0-T12", result: "PASS", command: "support-bundle" });

const supportPassed = runNode(support, ["--evidence-dir", evidence, "--result", failed ? "REWORK" : "PASS"]);
if (!supportPassed) {
  failed = true;
  writeJson(path.join(evidence, "test-results", "M0-T12.json"), { id: "M0-T12", result: "FAIL", command: "support-bundle" });
}

const rows = blockingTests.map((id, index) => ({
  Requirement: `M0-R${String(index + 1).padStart(2, "0")}`,
  Test: id,
  Evidence: `test-results/${id}.json`,
  Result: readJson(path.join(evidence, "test-results", `${id}.json`)).result,
  Blocking: "Yes",
}));
writeFileSync(path.join(evidence, "requirement-matrix.csv"), [
  "Requirement,Test,Evidence,Result,Blocking",
  ...rows.map((row) => Object.values(row).join(",")),
].join("\n") + "\n");
writeJson(path.join(evidence, "metrics", "metrics.json"), {
  finishedAt: new Date().toISOString(),
  blockingTests: blockingTests.length,
  layers: layerMetrics,
});

function resealRework() {
  const reportPath = path.join(evidence, "report.json");
  const passed = blockingTests.filter((id) => {
    const file = path.join(evidence, "test-results", `${id}.json`);
    return existsSync(file) && readJson(file).result === "PASS";
  }).length;
  if (existsSync(reportPath)) {
    const report = readJson(reportPath);
    writeJson(reportPath, {
      ...report,
      result: "REWORK",
      decision: "REWORK",
      blockingTests: { passed, total: blockingTests.length },
    });
  }
  writeFileSync(path.join(evidence, "report.md"), [
    "# M0 Acceptance",
    "",
    "Result: REWORK",
    "Decision: REWORK",
    "",
    "A blocking acceptance or evidence validation step failed.",
    "",
  ].join("\n"));
  rmSync(path.join(evidence, "MANIFEST"), { force: true });
  rmSync(path.join(evidence, "SHA256SUMS"), { force: true });
  if (!runNode(seal, ["--evidence-dir", evidence])) return false;
  const verified = runNode(validate, [
    "--bundle", evidence,
    "--secret", env.FAKE_PROVIDER_API_KEY,
    "--expected-result", "REWORK",
  ]);
  if (!verified) {
    rmSync(path.join(evidence, "MANIFEST"), { force: true });
    rmSync(path.join(evidence, "SHA256SUMS"), { force: true });
  }
  return verified;
}

const sealed = runNode(seal, ["--evidence-dir", evidence]);
if (!sealed) {
  failed = true;
  resealRework();
} else {
  const valid = runNode(validate, ["--bundle", evidence, "--secret", env.FAKE_PROVIDER_API_KEY]);
  if (!valid) {
    failed = true;
    resealRework();
  }
}

if (failed) {
  console.error(`REWORK: M0 acceptance failed; evidence retained at ${evidence}`);
  process.exit(1);
}
console.log(`PASS: M0 acceptance is GO; evidence retained at ${evidence}`);
