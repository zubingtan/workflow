import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

function workflow(name) {
  const relative = `.github/workflows/${name}`;
  const absolute = path.join(root, relative);
  assert.equal(existsSync(absolute), true, `missing required workflow: ${relative}`);
  return readFileSync(absolute, "utf8");
}

function topLevelKeys(block) {
  return [...block.matchAll(/^  ([A-Za-z0-9_-]+):\s*$/gm)].map((match) => match[1]);
}

function yamlBlock(source, name, indent = 0) {
  const prefix = " ".repeat(indent);
  const match = new RegExp(`^${prefix}${name}:\\s*$`, "m").exec(source);
  assert.ok(match, `missing YAML block: ${name}`);
  const rest = source.slice(match.index + match[0].length);
  const next = rest.search(new RegExp(`^${prefix}\\S`, "m"));
  return next === -1 ? rest : rest.slice(0, next);
}

test("the PR gate calls one reusable full acceptance workflow", () => {
  const prGate = workflow("pr-gate.yml");
  const jobs = yamlBlock(prGate, "jobs");
  assert.equal(topLevelKeys(jobs).length, 1);
  assert.equal((jobs.match(/uses:\s*\.\/\.github\/workflows\/m0-acceptance\.yml/g) ?? []).length, 1);
  assert.match(jobs, /git_sha:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  assert.equal((jobs.match(/make\s+verify-m0/g) ?? []).length, 0, "PR gate must not duplicate acceptance steps");

  const reusable = workflow("m0-acceptance.yml");
  assert.match(reusable, /workflow_call:[\s\S]{0,300}git_sha:[\s\S]{0,120}required:\s*true/);
  assert.match(reusable, /runs-on:\s*ubuntu-latest/);
  assert.match(reusable, /uses:\s*actions\/checkout@v7[\s\S]{0,180}ref:\s*\$\{\{\s*inputs\.git_sha\s*\}\}/);
  assert.match(reusable, /git\s+rev-parse\s+HEAD[\s\S]{0,240}(?:inputs\.git_sha|ACCEPTANCE_GIT_SHA)/);
  assert.match(reusable, /ACCEPTANCE_GIT_SHA:\s*\$\{\{\s*inputs\.git_sha\s*\}\}/);
  assert.equal((reusable.match(/make\s+verify-m0/g) ?? []).length, 1);
  const reportCheck = reusable.split(/\r?\n/).find((line) =>
    line.includes("report.json") && line.includes("gitSha") && line.includes("ACCEPTANCE_GIT_SHA"));
  assert.ok(reportCheck, "reusable acceptance must compare report gitSha with inputs.git_sha");
  assert.match(reusable, /COMPOSE_PROJECT_NAME|--project-name/);
  assert.match(reusable, /if:\s*\$\{\{\s*always\(\)\s*\}\}[\s\S]{0,500}down[^\n]*(?:--volumes|-v)/);
  assert.match(reusable, /actions\/upload-artifact@v7[\s\S]{0,240}name:[^\n]*\$\{\{\s*inputs\.git_sha\s*\}\}/);
});

test("the manual release gate chains three clean same-SHA runs and only aggregates evidence", () => {
  const release = workflow("m0-release-gate.yml");
  assert.match(release, /workflow_dispatch:[\s\S]{0,400}git_sha:[\s\S]{0,120}required:\s*true/);
  assert.match(release, /github\.run_attempt[\s\S]{0,240}(?:exit\s+1|false)/);
  assert.match(release, /origin\/main/);

  const jobs = yamlBlock(release, "jobs");
  for (const run of ["run1", "run2", "run3"]) {
    const block = yamlBlock(jobs, run, 2);
    assert.match(block, /uses:\s*\.\/\.github\/workflows\/m0-acceptance\.yml/);
    assert.match(block, /git_sha:\s*\$\{\{\s*needs\.validate\.outputs\.git_sha\s*\}\}/);
  }
  assert.match(yamlBlock(jobs, "run1", 2), /needs:\s*validate/);
  assert.match(yamlBlock(jobs, "run2", 2), /needs:\s*run1/);
  assert.match(yamlBlock(jobs, "run3", 2), /needs:\s*run2/);
  assert.match(yamlBlock(jobs, "aggregate", 2), /needs:\s*run3/);
  assert.match(yamlBlock(jobs, "aggregate", 2), /MANIFEST[\s\S]*SHA256SUMS/);
  assert.doesNotMatch(release, /(?:git\s+tag|gh\s+release|actions\/create-release|softprops\/action-gh-release)/i);
});
