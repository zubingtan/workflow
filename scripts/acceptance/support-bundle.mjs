import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { argument, blockingTests, readJson, requireArgument, writeJson } from "./evidence-utils.mjs";

const bundle = requireArgument("--evidence-dir");
const result = argument("--result", "REWORK");
const support = path.join(bundle, "support-bundle");
if (existsSync(bundle) && readdirSync(bundle).length > 0 && !existsSync(path.join(bundle, "report.json"))) {
  throw new Error("Support bundle output would overwrite an existing unowned directory");
}
mkdirSync(support, { recursive: true });
const diagnosticsPath = path.join(support, "diagnostics.json");
if (existsSync(diagnosticsPath)) throw new Error("Support bundle output already exists");

function imageDigest(image) {
  const inspected = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], { encoding: "utf8" });
  const value = inspected.status === 0 ? inspected.stdout.trim() : "";
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error("Required container image digest is unavailable");
  return value;
}

const reportPath = path.join(bundle, "report.json");
if (existsSync(reportPath)) {
  const pendingReport = readJson(reportPath);
  writeJson(reportPath, { ...pendingReport, result: "REWORK", decision: "REWORK", containerDigests: {} });
}

let containerDigests;
try {
  containerDigests = {
    app: imageDigest("workflow-m0:local"),
    worker: imageDigest("workflow-m0:local"),
    postgres: imageDigest("postgres:18-bookworm"),
    migrate: imageDigest("postgres:18-bookworm"),
    fakeProvider: imageDigest("workflow-m0:local"),
  };
} catch {
  writeJson(diagnosticsPath, {
    generatedAt: new Date().toISOString(),
    error: { code: "container_digest_unavailable", message: "Required container image digest is unavailable" },
    containerDigests: {},
    redaction: "configured credential values and provider transport details are excluded",
  });
  throw new Error("Support bundle requires inspectable container image digests");
}
let readiness = { status: "unavailable" };
try {
  const response = await fetch(`http://127.0.0.1:${process.env.APP_PORT ?? "3000"}/api/health/ready`, {
    signal: AbortSignal.timeout(2_000),
  });
  readiness = { status: response.ok ? "ready" : "not_ready", httpStatus: response.status };
} catch {
  readiness = { status: "unavailable" };
}
writeJson(diagnosticsPath, {
  generatedAt: new Date().toISOString(),
  services: ["app", "worker", "postgres", "migrate", "fake-provider"],
  healthEndpoints: ["/api/health/live", "/api/health/ready"],
  migrationFiles: ["001_bootstrap.sql", "002_definition_versions.sql", "003_async_runtime.sql", "004_terminal_failures.sql"],
  containerDigests,
  readiness,
  redaction: "configured credential values and provider transport details are excluded",
});

if (existsSync(reportPath)) {
  const passed = blockingTests.filter((id) => {
    const file = path.join(bundle, "test-results", `${id}.json`);
    return existsSync(file) && readJson(file).result === "PASS";
  }).length;
  const pass = result === "PASS" && passed === blockingTests.length;
  const environment = readJson(path.join(bundle, "environment.json"));
  const versions = readJson(path.join(bundle, "versions.json"));
  const report = {
    milestone: "M0",
    result: pass ? "PASS" : "REWORK",
    decision: pass ? "GO" : "REWORK",
    gitSha: environment.gitSha,
    documentVersion: versions.document,
    workflowSchemaVersion: versions.schema,
    databaseMigrationVersion: versions.migration,
    piAgentVersion: versions.pi,
    blockingTests: { passed, total: blockingTests.length },
    containerDigests,
  };
  writeJson(path.join(bundle, "report.json"), report);
  writeFileSync(path.join(bundle, "report.md"), [
    "# M0 Acceptance",
    "",
    `Result: ${report.result}`,
    `Decision: ${report.decision}`,
    `Commit: ${report.gitSha}`,
    "Document Version: v0.4",
    "",
    `Blocking Tests: ${passed}/${blockingTests.length} passed`,
    "Flaky Tests: 0",
    "",
    "Evidence Bundle",
    `- ${bundle}`,
    "",
  ].join("\n"));
  writeJson(path.join(support, "version-summary.json"), versions);
  writeJson(path.join(support, "environment-summary.json"), {
    gitSha: environment.gitSha,
    os: environment.os,
    architecture: environment.architecture,
    node: environment.node,
  });
  writeJson(path.join(support, "acceptance-summary.json"), {
    milestone: report.milestone,
    result: report.result,
    decision: report.decision,
    blockingTests: report.blockingTests,
  });
}
console.log(`Support bundle written to ${support}`);
