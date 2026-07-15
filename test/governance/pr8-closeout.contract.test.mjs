import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

function requiredFile(relative) {
  const absolute = path.join(root, relative);
  assert.equal(existsSync(absolute), true, `missing closeout artifact: ${relative}`);
  return readFileSync(absolute, "utf8");
}

function markdownSection(source, headingPattern) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => {
    const match = /^(#{1,6})\s+(.+)$/u.exec(line);
    return match && headingPattern.test(match[2]);
  });
  assert.notEqual(start, -1, `missing Markdown section: ${headingPattern}`);
  const level = /^(#+)/u.exec(lines[start])[1].length;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+/u.exec(lines[index]);
    if (match && match[1].length <= level) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/u, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  assert.equal(quoted, false, "unterminated quoted CSV field");
  if (field !== "" || row.length > 0) {
    row.push(field.replace(/\r$/u, ""));
    rows.push(row);
  }
  const [header, ...values] = rows;
  assert.ok(header?.length > 0, "CSV header is required");
  return {
    header,
    rows: values.map((cells) => {
      assert.equal(cells.length, header.length, "CSV row does not match its header");
      return Object.fromEntries(header.map((name, index) => [name, cells[index]]));
    }),
  };
}

function assertNoCredentialValues(source) {
  assert.doesNotMatch(source, /-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
  assert.doesNotMatch(source, /\bsk-[A-Za-z0-9_-]{8,}/u);
  for (const match of source.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD))\s*=\s*(.*?)\s*$/gmu)) {
    const [, name] = match;
    let value = match[2];
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
    const fixedFakeFixture = name === "FAKE_PROVIDER_API_KEY" && value === "fake-provider-local";
    assert.ok(
      value === "" || /^\$\{[^}]+\}$/u.test(value) || /^<[^>]+>$/u.test(value) || fixedFakeFixture,
      `documentation contains a non-placeholder credential assignment for ${name}`,
    );
  }
}

function assertPendingFinalRelease(section, artifact) {
  assert.match(section, /(?:final[\s-]*)?(?:three|3|三)[\s-]*(?:run|轮|次)[\s\S]{0,160}(?:PENDING|awaiting|待验收)|(?:PENDING|awaiting|待验收)[\s\S]{0,160}(?:three|3|三)[\s-]*(?:run|轮|次)/iu,
    `${artifact} must leave the final three-run gate pending`);
  for (const [name, pattern] of [["tag", /tag|标签/iu], ["release", /release|发布/iu]]) {
    assert.match(section, new RegExp(`(?:${pattern.source})[\\s\\S]{0,120}(?:PENDING|awaiting|待创建|待发布)|(?:PENDING|awaiting|待创建|待发布)[\\s\\S]{0,120}(?:${pattern.source})`, "iu"),
      `${artifact} must leave the ${name} pending`);
  }
  assert.doesNotMatch(section, /(?:final[\s-]*(?:three|3|三)[\s-]*(?:run|轮|次)|final[\s-]*(?:acceptance|gate|验收))[^.。\n]{0,80}(?:(?:is|was|has been)\s*:?[\s-]*completed|已完成)|(?:tag|标签)[^.。\n]{0,80}(?:(?:is|was|has been)\s*:?[\s-]*(?:created|tagged)|已创建)|(?:release|发布)[^.。\n]{0,80}(?:(?:is|was|has been)\s*:?[\s-]*(?:created|released|published)|已创建|已发布)/iu,
    `${artifact} prematurely claims the final release gate or publication`);
}

test("pending release guard distinguishes negation from affirmative completion", () => {
  const pending = [
    "Final three-run gate is not yet completed; status PENDING.",
    "Tag has never been created or tagged; status awaiting.",
    "Release has not been released or published; status PENDING.",
  ].join("\n");
  assert.doesNotThrow(() => assertPendingFinalRelease(pending, "self-check pending fixture"));

  for (const affirmative of [
    "Final three-run gate has been completed.",
    "Tag has been created.",
    "Release is published.",
  ]) {
    assert.throws(
      () => assertPendingFinalRelease(`${pending}\n${affirmative}`, "self-check affirmative fixture"),
      /prematurely claims/u,
    );
  }
});

test("README is an executable, secret-safe M0 operator guide", () => {
  const readme = requiredFile("README.md");
  markdownSection(readme, /quick\s*start|getting started|快速开始/iu);
  markdownSection(readme, /provider.*binding|binding.*provider|供应商.*绑定/iu);
  markdownSection(readme, /commands|operations|命令|运维/iu);
  const limits = markdownSection(readme, /limits|limitations|scope|限制|范围/iu);

  const bindingDocuments = [...readme.matchAll(/```json\s*\n([\s\S]*?)```/giu)]
    .map((match) => JSON.parse(match[1]))
    .filter((document) => document && typeof document.bindings === "object");
  assert.ok(bindingDocuments.length >= 2, "README needs Fake and real Provider Binding JSON examples");
  const bindings = bindingDocuments.flatMap((document) => Object.values(document.bindings));
  const allowed = new Set(["provider", "baseUrl", "apiKeyEnv", "model", "parameters"]);
  for (const binding of bindings) {
    assert.equal(binding && typeof binding === "object" && !Array.isArray(binding), true);
    for (const field of ["provider", "baseUrl", "apiKeyEnv", "model"]) {
      assert.equal(typeof binding[field], "string", `binding is missing ${field}`);
      assert.ok(binding[field].length > 0, `binding has empty ${field}`);
    }
    assert.deepEqual(Object.keys(binding).filter((field) => !allowed.has(field)), []);
    if (Object.hasOwn(binding, "parameters")) {
      assert.equal(binding.parameters && typeof binding.parameters === "object" && !Array.isArray(binding.parameters), true);
      assert.deepEqual(Object.keys(binding.parameters).filter((field) => field !== "temperature"), [],
        "README binding parameters are limited to temperature");
      assert.equal(typeof binding.parameters.temperature, "number");
      assert.equal(Number.isFinite(binding.parameters.temperature), true);
    }
  }
  assert.ok(bindings.some((binding) => /fake-provider|127\.0\.0\.1|localhost/iu.test(binding.baseUrl)));
  assert.ok(bindings.some((binding) => binding.provider === "openai-compatible" && /^https:\/\//u.test(binding.baseUrl)));

  assert.match(readme, /prompt[\s\S]{0,240}(?:run[\s-]*sheet|sheet[\s\S]{0,80}run)|run[\s-]*sheet[\s\S]{0,240}prompt/iu);
  for (const target of ["setup", "doctor", "up", "down", "logs", "smoke-test", "support-bundle", "verify-m0"]) {
    assert.match(readme, new RegExp(`\\bmake\\s+${target}\\b`, "u"), `README omits make ${target}`);
  }
  for (const boundary of [/builder/iu, /retry|cancel/iu, /SSE/u, /RBAC|multi-user/iu, /Feishu|Human Interaction/iu, /memory/iu]) {
    assert.match(limits, boundary, `README does not state M0 boundary ${boundary}`);
  }
  assertNoCredentialValues(readme);
});

test("implementation plan closes out as-built facts, differences, and deferred scope", () => {
  const plan = requiredFile("docs/plans/M0/implementation-plan.md");
  const asBuilt = markdownSection(plan, /as[- ]built|implemented system|实际实现/iu);
  const differences = markdownSection(plan, /differences|deviations|差异/iu);
  const deferred = markdownSection(plan, /deferred|out of scope|延后|范围外/iu);
  assert.doesNotMatch(plan, /\b(?:TODO|TBD)\b|complete (?:this|in) PR8/iu);

  for (const service of ["app", "worker", "postgres", "migrate", "fake-provider"]) assert.match(asBuilt, new RegExp(`\\b${service}\\b`, "iu"));
  for (const route of [
    "/api/workflows", "/api/workflows/import", "/api/runs", "/api/health/live", "/api/health/ready",
  ]) assert.match(asBuilt, new RegExp(route.replaceAll("/", "\\/"), "u"));
  for (const fact of [/Playwright/iu, /support[- ]bundle/iu, /PostgreSQL/iu, /queue|lease/iu]) assert.match(asBuilt, fact);
  assert.match(differences, /TypeScript|Next\.js|compile|generate|WORKFLOW_ENV_FILE|digest|ubuntu-24\.04/iu);
  assert.ok(differences.split(/\n\s*\n|^\s*[-*]\s+/mu).filter((value) => value.trim().length > 20).length >= 2);
  for (const boundary of [/Builder/iu, /Retry|Cancel/iu, /Human Interaction/iu, /SSE/iu, /RBAC|multi-user/iu]) assert.match(deferred, boundary);

  const schemaDeferred = markdownSection(
    requiredFile("docs/plans/M0/schema-api-event-error-spec.md"),
    /deferred runtime behavior|deferred|延后/iu,
  );
  for (const boundary of [/Retry|Cancel/iu, /Human Interaction/iu, /SSE/iu]) assert.match(schemaDeferred, boundary);
  assert.doesNotMatch(schemaDeferred, /PR6[^\n]*(?:remain|is) deferred|PR7[^\n]*(?:remain|is) deferred/iu,
    "schema still defers M0 UI or Support Bundle after their implementation PRs");
});

test("acceptance and rollout describe one same-SHA three-run dispatch", () => {
  const documents = [
    "docs/plans/M0/acceptance.md",
    "docs/plans/M0/rollout.md",
  ];
  for (const relative of documents) {
    const source = requiredFile(relative);
    assert.match(source, /workflow_dispatch/u, `${relative} does not name the release trigger`);
    assert.match(source, /(?:final|main)[\s-]*(?:Git[\s-]*)?SHA|same[\s-]*SHA/iu, `${relative} does not freeze one candidate SHA`);
    for (const run of ["run1", "run2", "run3"]) assert.match(source, new RegExp(`\\b${run}\\b`, "u"));
    assert.match(source, /clean|isolated/iu, `${relative} does not require isolated runners`);
    assert.match(source, /sequential|chain|needs|串联|依赖/iu, `${relative} does not describe job ordering`);
    assert.match(source, /fail[\s\S]{0,160}REWORK|REWORK[\s\S]{0,160}fail/iu, `${relative} does not invalidate the series`);
    assert.doesNotMatch(source, /run (?:the )?release workflow three times|three (?:manual )?workflow_dispatch|workflow_dispatch three times/iu);
  }

  const acceptance = requiredFile("docs/plans/M0/acceptance.md");
  assert.match(acceptance, /requirement-test-evidence\.csv/u);
  assert.match(acceptance, /requirement-matrix\.csv/u);
  assert.match(acceptance, /runtime|generated|运行时|生成/iu);
  assert.match(acceptance, /MANIFEST[\s\S]{0,120}SHA256SUMS|SHA256SUMS[\s\S]{0,120}MANIFEST/u);
});

test("retrospective contains evidence-backed closeout instead of instructions", () => {
  const retrospective = requiredFile("docs/plans/M0/retrospective.md");
  const outcome = markdownSection(retrospective, /outcome|结果/iu);
  const sections = [
    outcome,
    markdownSection(retrospective, /what worked|有效|奏效/iu),
    markdownSection(retrospective, /rework|返工|调整/iu),
    markdownSection(retrospective, /residual risks|remaining risks|残余风险/iu),
    markdownSection(retrospective, /follow[- ]up|后续/iu),
  ];
  assert.doesNotMatch(retrospective, /complete this document|record concrete evidence|list failed gates|document known limitations|\b(?:TODO|TBD)\b/iu);
  assert.doesNotMatch(retrospective, /^\s*[-*]\s+[^:\n]+:\s*$/gmu);
  for (const section of sections) assert.ok(section.length >= 60, "retrospective section is still empty or instructional");
  assert.match(retrospective, /\b[a-f0-9]{7,40}\b|\b(?:run|artifact)\s*#?\d{6,}\b/iu);
  assert.match(retrospective, /\b\d+\s*\/\s*\d+\b|\b\d+\s+(?:tests?|checks?)\b/iu);
  assert.match(sections[3], /risk|limitation|unknown|风险|限制/iu);
  assertPendingFinalRelease(outcome, "retrospective outcome");
});

test("release notes exist as a pending, scope-accurate M0 handoff", () => {
  const notes = requiredFile("docs/plans/M0/release-notes.md");
  markdownSection(notes, /delivered|included|交付/iu);
  markdownSection(notes, /operations|quick start|运行|运维/iu);
  const limitations = markdownSection(notes, /known limitations|limits|限制/iu);
  const status = markdownSection(notes, /validation|release status|验收|发布状态/iu);
  assert.match(notes, /m0-v0\.1\.0|v0\.1\.0/iu);
  assert.match(status, /three|3|三/iu);
  assert.match(status, /same[\s-]*SHA|同一[\s-]*SHA/iu);
  assert.match(status, /gate|workflow_dispatch|验收/iu);
  assertPendingFinalRelease(status, "release notes status");
  for (const boundary of [/Builder/iu, /Retry|Cancel/iu, /SSE/iu]) assert.match(limitations, boundary);
  assertNoCredentialValues(notes);
});

test("source requirement matrix remains a 13-row PENDING template for sealed runtime evidence", () => {
  const { header, rows } = parseCsv(requiredFile("docs/plans/M0/requirement-test-evidence.csv"));
  assert.deepEqual(header, ["Requirement", "Test", "Evidence", "Result", "Blocking"]);
  assert.equal(rows.length, 13);
  const testIds = [
    "M0-T01", "M0-T02", "M0-T03", "M0-T04", "M0-T05", "M0-T06", "M0-T07",
    "M0-T07E", "M0-T08", "M0-T09", "M0-T10", "M0-T11", "M0-T12",
  ];
  assert.equal(new Set(rows.map((row) => row.Requirement)).size, 13);
  assert.equal(new Set(rows.map((row) => row.Test)).size, 13);
  rows.forEach((row, index) => {
    assert.equal(row.Requirement, `M0-R${String(index + 1).padStart(2, "0")}`);
    assert.equal(row.Test, testIds[index]);
    assert.equal(row.Evidence, `test-results/${row.Test}.json`);
    assert.equal(row.Result, "PENDING", "source CSV must not forge a final result");
    assert.equal(row.Blocking, "Yes");
  });
});

test("agent ledger covers PR1 through PR8 and PR7a with auditable routing", () => {
  const source = requiredFile("docs/plans/M0/pr-agent-ledger.csv");
  assertNoCredentialValues(source);
  const { header, rows } = parseCsv(source);
  for (const column of ["PR", "Agent", "ConfiguredModel", "ReasoningEffort", "Task", "Commit", "Verification"]) {
    assert.ok(header.includes(column), `ledger header omits ${column}`);
  }
  const requiredPrs = ["PR1", "PR2", "PR3", "PR4", "PR5", "PR6", "PR7", "PR7a", "PR8"];
  for (const pr of requiredPrs) assert.ok(rows.some((row) => row.PR === pr), `ledger omits ${pr}`);

  const roles = new Set([
    "repo-scout", "docs-contract", "test-author", "backend-runtime", "frontend-ui",
    "e2e-verifier", "verifier-reviewer", "release-manager",
  ]);
  for (const row of rows) {
    assert.ok(roles.has(row.Agent), `unapproved ledger role: ${row.Agent}`);
    assert.match(row.ConfiguredModel, /^gpt-5\.6-(?:luna|terra)$/u);
    assert.doesNotMatch(row.ConfiguredModel, /sol/iu);
    assert.equal(row.ReasoningEffort, row.ConfiguredModel.endsWith("terra") ? "ultra" : "max");
    assert.ok(row.Task.trim().length > 0, "ledger task is empty");
    if (row.PR === "PR8" && row.Commit === "PENDING") {
      // PR8's own closeout commit is recorded by the later release-manager step.
    } else {
      const commits = row.Commit.split(";");
      assert.ok(commits.length > 0 && commits.every((commit) => /^[a-f0-9]{7,40}$/u.test(commit)));
    }
    assert.match(row.Verification, /test|check|run|evidence|RED|GREEN|PASS|验收|测试/iu);
  }
});
