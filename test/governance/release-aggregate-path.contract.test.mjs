import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

function artifactFiles(directory, relative = "") {
  return readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? artifactFiles(directory, child) : [child];
  });
}

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

test("the release aggregate artifact is self-contained and verifies from its root", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/m0-release-gate.yml"), "utf8");
  const block = workflow.match(
    /      - name: Verify and aggregate immutable evidence\n        shell: bash\n        run: \|\n([\s\S]*?)(?=      - name: Upload aggregate evidence)/u,
  );
  assert.ok(block, "missing aggregate packaging script");

  const gitSha = "c".repeat(40);
  const ledger = "PR,Agent,Model\nPR8,test-author,gpt-5.6-terra\n";
  const directory = mkdtempSync(path.join(tmpdir(), "m0-release-artifact-"));
  try {
    for (const run of ["run1", "run2", "run3"]) {
      const bundle = path.join(directory, "aggregate", "runs", run);
      mkdirSync(bundle, { recursive: true });
      writeFileSync(path.join(bundle, "report.json"), JSON.stringify({ gitSha }));
      writeFileSync(path.join(bundle, "payload.txt"), `${run} evidence\n`);
    }
    const ledgerPath = path.join(directory, "docs", "plans", "M0", "pr-agent-ledger.csv");
    mkdirSync(path.dirname(ledgerPath), { recursive: true });
    writeFileSync(ledgerPath, ledger);
    const validator = path.join(directory, "scripts", "acceptance", "validate-evidence.mjs");
    mkdirSync(path.dirname(validator), { recursive: true });
    writeFileSync(validator, "");

    const script = block[1]
      .split("\n")
      .map((line) => line.replace(/^ {10}/u, ""))
      .join("\n")
      .replaceAll("${{ inputs.git_sha }}", gitSha);
    const packaged = spawnSync("bash", ["-c", script], { cwd: directory, encoding: "utf8" });
    assert.equal(packaged.status, 0, packaged.stderr || packaged.stdout);

    const artifact = path.join(directory, "aggregate");
    const initialFiles = artifactFiles(artifact);
    const ledgerCopy = initialFiles.find((file) => path.basename(file) === "pr-agent-ledger.csv");
    assert.ok(ledgerCopy, "aggregate artifact must include the agent ledger");
    assert.equal(
      readFileSync(path.join(artifact, ledgerCopy), "utf8"),
      ledger,
      "aggregate artifact must include the exact agent ledger",
    );

    const finalShaMetadata = initialFiles
      .filter((file) => !file.startsWith(`runs${path.sep}`))
      .filter((file) => !["MANIFEST", "SHA256SUMS", ledgerCopy].includes(file))
      .some((file) => readFileSync(path.join(artifact, file), "utf8").includes(gitSha));
    assert.equal(finalShaMetadata, true, "aggregate artifact must include explicit final SHA metadata");

    const manifest = readFileSync(path.join(artifact, "MANIFEST"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    for (const file of manifest) {
      assert.equal(path.isAbsolute(file), false, `MANIFEST path must be relative: ${file}`);
      assert.doesNotMatch(file, /^(?:\.\/)?aggregate\//u, `MANIFEST path must start at artifact root: ${file}`);
    }
    const normalizedManifest = manifest.map((file) => file.replace(/^\.\//u, "")).sort();
    const payloads = artifactFiles(artifact)
      .filter((file) => !["MANIFEST", "SHA256SUMS"].includes(file))
      .sort();
    assert.deepEqual(normalizedManifest, payloads, "MANIFEST must cover every aggregate payload");

    const checksummed = readFileSync(path.join(artifact, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^[a-f0-9]{64}\s+[*]?(.+)$/u);
        assert.ok(match, `invalid SHA256SUMS entry: ${line}`);
        return match[1].replace(/^\.\//u, "");
      })
      .sort();
    assert.deepEqual(checksummed, [...payloads, "MANIFEST"].sort(), "SHA256SUMS must cover payloads and MANIFEST");

    const verified = spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: artifact, encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);

    writeFileSync(path.join(artifact, "runs", "run3", "payload.txt"), "tampered evidence\n");
    const tampered = spawnSync("sha256sum", ["-c", "SHA256SUMS"], { cwd: artifact, encoding: "utf8" });
    assert.notEqual(tampered.status, 0, "aggregate checksums must reject a tampered payload");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
