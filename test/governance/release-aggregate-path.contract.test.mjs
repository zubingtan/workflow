import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

test("the release aggregate reads downloaded report paths as files", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/m0-release-gate.yml"), "utf8");
  const loop = workflow.match(/          for bundle in aggregate\/runs\/\*; do\n([\s\S]*?)          done/u);
  assert.ok(loop, "missing aggregate evidence loop");

  const gitSha = "a".repeat(40);
  const directory = mkdtempSync(path.join(tmpdir(), "m0-release-aggregate-"));
  try {
    for (const run of ["run1", "run2", "run3"]) {
      const bundle = path.join(directory, "aggregate", "runs", run);
      mkdirSync(bundle, { recursive: true });
      writeFileSync(path.join(bundle, "report.json"), JSON.stringify({ gitSha }));
    }

    const extractedChecks = loop[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("node scripts/acceptance/validate-evidence.mjs"))
      .join("\n");
    assert.match(extractedChecks, /report\.json/u, "aggregate must load each report.json");
    assert.match(extractedChecks, /\$\{\{\s*inputs\.git_sha\s*\}\}/u, "aggregate must compare the candidate SHA");

    const checks = extractedChecks.replaceAll("${{ inputs.git_sha }}", gitSha);
    const verify = () => spawnSync(
      "bash",
      ["-c", `set -euo pipefail\nfor bundle in aggregate/runs/*; do\n${checks}\ndone`],
      { cwd: directory, encoding: "utf8" },
    );

    const valid = verify();
    assert.equal(valid.status, 0, valid.stderr || valid.stdout);

    writeFileSync(
      path.join(directory, "aggregate", "runs", "run3", "report.json"),
      JSON.stringify({ gitSha: "b".repeat(40) }),
    );
    const mismatched = verify();
    assert.notEqual(mismatched.status, 0, "aggregate must validate all three report SHAs");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
