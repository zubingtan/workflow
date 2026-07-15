import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { blockingTests, requireArgument, sha256Text, writeJson } from "./evidence-utils.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const bundle = requireArgument("--evidence-dir");

function repositoryGitSha() {
  let gitDirectory = path.join(root, ".git");
  if (statSync(gitDirectory).isFile()) {
    const pointer = readFileSync(gitDirectory, "utf8").trim();
    if (!pointer.startsWith("gitdir: ")) throw new Error("Invalid Git worktree pointer");
    gitDirectory = path.resolve(root, pointer.slice("gitdir: ".length));
  }
  const head = readFileSync(path.join(gitDirectory, "HEAD"), "utf8").trim();
  if (/^[a-f0-9]{40}$/u.test(head)) return head;
  if (!head.startsWith("ref: ")) throw new Error("Cannot resolve repository Git SHA");
  const reference = head.slice("ref: ".length);
  const loose = path.join(gitDirectory, reference);
  if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
  const packed = readFileSync(path.join(gitDirectory, "packed-refs"), "utf8");
  return packed.split(/\r?\n/u).find((line) => line.endsWith(` ${reference}`))?.split(" ")[0];
}

if (existsSync(bundle) && readdirSync(bundle).length > 0) {
  throw new Error("Evidence output already exists and is not empty");
}

for (const directory of [
  "test-results", "event-exports", "logs", "screenshots", "traces", "metrics", "support-bundle",
]) mkdirSync(path.join(bundle, directory), { recursive: true });

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const gitSha = process.env.ACCEPTANCE_GIT_SHA ?? process.env.GITHUB_SHA ?? repositoryGitSha();
if (!/^[a-f0-9]{40}$/u.test(gitSha)) throw new Error("Acceptance Git SHA must be 40 lowercase hex characters");

const rows = blockingTests.map((testId, index) => ({
  Requirement: `M0-R${String(index + 1).padStart(2, "0")}`,
  Test: testId,
  Evidence: `test-results/${testId}.json`,
  Result: "PENDING",
  Blocking: "Yes",
}));

writeJson(path.join(bundle, "environment.json"), {
  gitSha,
  os: `${os.platform()} ${os.release()}`,
  architecture: os.arch(),
  node: process.version,
  testConfigurationHash: sha256Text([
    readFileSync(path.join(root, "compose.yaml"), "utf8"),
    readFileSync(path.join(root, "playwright.config.ts"), "utf8"),
  ].join("\n")),
});
writeJson(path.join(bundle, "versions.json"), {
  document: "v0.4",
  schema: "oncall.workflow/v1alpha1",
  migration: "004_terminal_failures.sql",
  pi: packageJson.dependencies["@mariozechner/pi-agent-core"],
  dependencies: {
    next: packageJson.dependencies.next,
    postgres: packageJson.dependencies.postgres,
    react: packageJson.dependencies.react,
    playwright: packageJson.devDependencies["@playwright/test"],
    typescript: packageJson.devDependencies.typescript,
    vitest: packageJson.devDependencies.vitest,
  },
});
writeJson(path.join(bundle, "report.json"), {
  milestone: "M0",
  result: "REWORK",
  decision: "REWORK",
  gitSha,
  documentVersion: "v0.4",
  workflowSchemaVersion: "oncall.workflow/v1alpha1",
  databaseMigrationVersion: "004_terminal_failures.sql",
  piAgentVersion: packageJson.dependencies["@mariozechner/pi-agent-core"],
  blockingTests: { passed: 0, total: blockingTests.length },
  containerDigests: {},
});
writeJson(path.join(bundle, "metrics/metrics.json"), {
  startedAt: new Date().toISOString(),
  blockingTests: blockingTests.length,
});

const header = "Requirement,Test,Evidence,Result,Blocking";
const csv = [header, ...rows.map((row) => Object.values(row).join(","))].join("\n") + "\n";
writeFileSync(path.join(bundle, "requirement-matrix.csv"), csv);
writeFileSync(path.join(bundle, "report.md"), "# M0 Acceptance\n\nResult: REWORK\nDecision: REWORK\n\nAcceptance is running.\n");
