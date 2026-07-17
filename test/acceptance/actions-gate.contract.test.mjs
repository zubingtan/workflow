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

test("all release workflows pin runners, actions, and external service images", () => {
  const workflows = ["pr-gate.yml", "m0-acceptance.yml", "m0-release-gate.yml"]
    .map((name) => ({ name, source: workflow(name) }));
  for (const { name, source } of workflows) {
    for (const runner of [...source.matchAll(/^\s*runs-on:\s*([^\s#]+)\s*$/gm)].map((match) => match[1])) {
      assert.equal(runner, "ubuntu-24.04", `${name} uses a floating runner: ${runner}`);
    }
    for (const action of [...source.matchAll(/^\s*uses:\s*([^\s#]+)\s*$/gm)].map((match) => match[1])) {
      if (action.startsWith("./")) continue;
      assert.match(action, /^[^@\s]+@[a-f0-9]{40}$/u, `${name} uses an unpinned external action: ${action}`);
    }
  }

  const compose = readFileSync(path.join(root, "compose.yaml"), "utf8");
  const composePostgres = compose.match(/^  postgres:\s*$[\s\S]*?^    image:\s*([^\s#]+)\s*$/m)?.[1];
  const acceptancePostgres = workflow("m0-acceptance.yml")
    .match(/^      postgres:\s*$[\s\S]*?^        image:\s*([^\s#]+)\s*$/m)?.[1];
  assert.match(composePostgres ?? "", /^postgres:[^@\s]+@sha256:[a-f0-9]{64}$/u);
  assert.equal(acceptancePostgres, composePostgres, "Actions must reuse the Compose PostgreSQL digest");
});

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

function jobNeeds(block) {
  const inline = block.match(/^    needs:\s*\[([^\]]+)\]\s*$/m);
  if (inline) return inline[1].split(",").map((value) => value.trim());
  const scalar = block.match(/^    needs:\s*([A-Za-z0-9_-]+)\s*$/m);
  if (scalar) return [scalar[1]];
  const header = /^    needs:\s*$/m.exec(block);
  assert.ok(header, "missing job needs");
  const remainder = block.slice(header.index + header[0].length);
  const end = remainder.search(/^    \S/m);
  const list = end === -1 ? remainder : remainder.slice(0, end);
  return [...list.matchAll(/^      -\s*([A-Za-z0-9_-]+)\s*$/gm)].map((match) => match[1]);
}

test("the PR gate runs only typecheck and no-database, no-browser fast contracts", () => {
  const prGate = workflow("pr-gate.yml");
  const jobs = yamlBlock(prGate, "jobs");
  assert.equal(topLevelKeys(jobs).length, 1);
  assert.match(jobs, /pnpm\s+typecheck/);
  assert.match(jobs, /pnpm\s+test:fast/);
  assert.equal((jobs.match(/uses:\s*\.\/\.github\/workflows\/m0-acceptance\.yml/g) ?? []).length, 0);
  assert.doesNotMatch(jobs, /(?:make\s+verify-m0|docker|postgres|playwright|chromium|upload-artifact)/i);

  const reusable = workflow("m0-acceptance.yml");
  assert.match(reusable, /workflow_call:[\s\S]{0,300}git_sha:[\s\S]{0,120}required:\s*true/);
  assert.match(reusable, /runs-on:\s*ubuntu-24\.04/);
  assert.match(reusable, /uses:\s*actions\/checkout@[a-f0-9]{40}[\s\S]{0,180}ref:\s*\$\{\{\s*inputs\.git_sha\s*\}\}/);
  assert.match(reusable, /git\s+rev-parse\s+HEAD[\s\S]{0,240}(?:inputs\.git_sha|ACCEPTANCE_GIT_SHA)/);
  assert.match(reusable, /ACCEPTANCE_GIT_SHA:\s*\$\{\{\s*inputs\.git_sha\s*\}\}/);
  assert.match(reusable, /WORKFLOW_IMAGE_TAG:\s*\$\{\{\s*inputs\.git_sha\s*\}\}/);
  assert.equal((reusable.match(/make\s+verify-m0/g) ?? []).length, 1);
  const reportCheck = reusable.split(/\r?\n/).find((line) =>
    line.includes("report.json") && line.includes("gitSha") && line.includes("ACCEPTANCE_GIT_SHA"));
  assert.ok(reportCheck, "reusable acceptance must compare report gitSha with inputs.git_sha");
  assert.match(reusable, /COMPOSE_PROJECT_NAME|--project-name/);
  assert.match(reusable, /if:\s*\$\{\{\s*always\(\)\s*\}\}[\s\S]{0,500}down[^\n]*(?:--volumes|-v)/);
  assert.match(reusable, /actions\/upload-artifact@[a-f0-9]{40}[\s\S]{0,240}name:[^\n]*\$\{\{\s*inputs\.git_sha\s*\}\}/);
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
  assert.deepEqual(jobNeeds(yamlBlock(jobs, "run1", 2)), ["validate"]);
  assert.deepEqual(jobNeeds(yamlBlock(jobs, "run2", 2)).sort(), ["run1", "validate"]);
  assert.deepEqual(jobNeeds(yamlBlock(jobs, "run3", 2)).sort(), ["run2", "validate"]);
  const aggregateNeeds = jobNeeds(yamlBlock(jobs, "aggregate", 2));
  for (const run of ["run1", "run2", "run3"]) assert.ok(aggregateNeeds.includes(run));
  assert.match(yamlBlock(jobs, "aggregate", 2), /MANIFEST[\s\S]*SHA256SUMS/);
  assert.doesNotMatch(release, /(?:git\s+tag|gh\s+release|actions\/create-release|softprops\/action-gh-release)/i);
});
