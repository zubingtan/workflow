import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const approvedAgents = {
  "backend-runtime": {
    model: "gpt-5.6-terra",
    effort: "high",
  },
  "docs-contract": {
    model: "gpt-5.6-luna",
    effort: "medium",
  },
  "e2e-verifier": {
    model: "gpt-5.6-terra",
    effort: "high",
  },
  "frontend-ui": {
    model: "gpt-5.6-terra",
    effort: "high",
  },
  "release-manager": {
    model: "gpt-5.6-luna",
    effort: "high",
  },
  "repo-scout": {
    model: "gpt-5.6-luna",
    effort: "medium",
  },
  "test-author": {
    model: "gpt-5.6-terra",
    effort: "high",
  },
  "verifier-reviewer": {
    model: "gpt-5.6-terra",
    effort: "high",
  },
};

const sourceArtifacts = {
  "01-PRD.md": "2dbd749ebcf89d69fc86431e64573bda3f35dd5b0202be096c9bb8c94669c4b1",
  "02-DESIGN-DOC.md": "f618087e982285412e092664ddc07bc22ee05df1cf41f9347be78659fdc873d6",
  "03-ADR.md": "67874d2c8f36becf096580c154c701509150009190a7f42dadf4f19b802ee696",
  "04-ROADMAP.md": "01cf69ce9cd259bd613e4bad9e5ccaea22986f6b3fc68c5579d2f34c6df4b37b",
  "05-DOCUMENTATION-GOVERNANCE.md": "2c620ffc1e851ef0be9da6c0967738388ffb0f95955d27ff4d69afcb0c5f20c9",
  "06-MEMORY-DESIGN.md": "81880c170c6455b9b2429683241d54ae285ec3ce2adc354f4baa94b170147f45",
  "07-WORKFLOW-TESTING-UX.md": "7ac7164b0206316d09f2df82941d979563c2017d04fefbdf2fab16be4cb3231f",
  "08-FEASIBILITY-ANALYSIS.md": "04e23f6e9b386decbfd9841b2cee293f3f739d6f94803a666edbd5766206c86b",
  "09-MILESTONE-AUTOMATED-ACCEPTANCE.md": "cf6c8352b17b577be07e5ad59f9dc8504187651fda7785f23bf6a0ae4b42d881",
  "CHANGELOG-v0.4.md": "1cd702ba0d8f4f0d74147941e9e948dba73c1f120315f73d6b08bcec0b7bb2d7",
  "README.md": "07e71ace86348b9e8f98c37aa8b487211fe8193019e656e1e94c2af2896566eb",
  "VALIDATION-REPORT.md": "e9ae96ffbf5b14441d931abbe8ba4fffcf73026408d66485faabe3e60eec591c",
  "VALIDATION.json": "56b16ebdbac6f263423278ac9facfc12f92e9319256fc0b0481a6a9e5d543e36",
};

function projectPath(...segments) {
  return path.join(repositoryRoot, ...segments);
}

function requireFile(relativePath) {
  const absolutePath = projectPath(relativePath);
  assert.equal(
    existsSync(absolutePath) && statSync(absolutePath).isFile(),
    true,
    `missing required file: ${relativePath}`,
  );
  return readFileSync(absolutePath, "utf8");
}

function requireDirectory(relativePath) {
  const absolutePath = projectPath(relativePath);
  assert.equal(
    existsSync(absolutePath) && statSync(absolutePath).isDirectory(),
    true,
    `missing required directory: ${relativePath}`,
  );
  return absolutePath;
}

function tomlSection(content, sectionName) {
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\[${escapedName}\\]\\s*$`, "m").exec(content);
  assert.ok(header, `missing TOML section [${sectionName}]`);

  const sectionStart = header.index + header[0].length;
  const remainder = content.slice(sectionStart);
  const nextHeader = remainder.search(/^\\[[^\\]]+\\]\\s*$/m);
  return nextHeader === -1 ? remainder : remainder.slice(0, nextHeader);
}

function tomlScalar(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`^${escapedKey}\\s*=\\s*(true|false|-?\\d+|"[^"]*")\\s*$`, "m"),
  );
  assert.ok(match, `missing TOML key: ${key}`);

  if (match[1] === "true" || match[1] === "false") {
    return match[1] === "true";
  }
  if (/^-?\d+$/.test(match[1])) {
    return Number(match[1]);
  }
  return JSON.parse(match[1]);
}

function tomlString(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `^${escapedKey}\\s*=\\s*(?:"""([\\s\\S]*?)"""|'''([\\s\\S]*?)'''|("(?:\\\\.|[^"\\\\])*")|'([^']*)')\\s*$`,
      "m",
    ),
  );
  assert.ok(match, `missing TOML string: ${key}`);

  if (match[1] !== undefined || match[2] !== undefined) {
    return match[1] ?? match[2];
  }
  if (match[3] !== undefined) {
    return JSON.parse(match[3]);
  }
  return match[4];
}

function walkFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") {
      return [];
    }
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
  });
}

function sha256(absolutePath) {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

test("project Codex config enables bounded direct-child multi-agent work", () => {
  const config = requireFile(".codex/config.toml");
  const features = tomlSection(config, "features");
  const agents = tomlSection(config, "agents");

  assert.equal(tomlScalar(features, "multi_agent"), true);
  assert.equal(tomlScalar(agents, "max_threads"), 3);
  assert.equal(tomlScalar(agents, "max_depth"), 1);
});

test("exactly the eight approved custom agent roles are configured", () => {
  const agentDirectory = requireDirectory(".codex/agents");
  const actualFiles = readdirSync(agentDirectory)
    .filter((fileName) => fileName.endsWith(".toml"))
    .sort();
  const expectedFiles = Object.keys(approvedAgents)
    .map((role) => `${role}.toml`)
    .sort();

  assert.deepEqual(actualFiles, expectedFiles);

  for (const [role, expected] of Object.entries(approvedAgents)) {
    const content = requireFile(`.codex/agents/${role}.toml`);
    assert.equal(tomlString(content, "name"), role, `${role} name must match its role`);
    assert.ok(
      tomlString(content, "description").trim(),
      `${role} must have a non-empty description`,
    );
    assert.ok(
      tomlString(content, "developer_instructions").trim(),
      `${role} must have non-empty developer_instructions`,
    );
    assert.equal(tomlString(content, "model"), expected.model, `${role} model mismatch`);
    assert.equal(
      tomlString(content, "model_reasoning_effort"),
      expected.effort,
      `${role} reasoning effort mismatch`,
    );
  }
});

test("agent policy contains no MDC files or unapproved model declarations", () => {
  const allFiles = walkFiles(repositoryRoot);
  const mdcFiles = allFiles
    .filter((absolutePath) => absolutePath.endsWith(".mdc"))
    .map((absolutePath) => path.relative(repositoryRoot, absolutePath));
  assert.deepEqual(mdcFiles, [], "agent policy must not use .mdc files");

  const agentDirectory = requireDirectory(".codex/agents");
  const approvedModels = new Set([
    "gpt-5.6-luna",
    "gpt-5.6-terra",
  ]);
  for (const fileName of readdirSync(agentDirectory).filter((name) => name.endsWith(".toml"))) {
    const content = readFileSync(path.join(agentDirectory, fileName), "utf8");
    assert.doesNotMatch(
      content,
      /gpt-5\.6-sol/,
      `${fileName} must not assign the orchestration-only Sol model to a subagent`,
    );
    const declaredModel = tomlString(content, "model");
    assert.equal(
      approvedModels.has(declaredModel),
      true,
      `${fileName} declares unapproved model ${declaredModel}`,
    );
  }
});

test("root AGENTS.md limits the main agent to orchestration and enforces one writer", () => {
  const content = requireFile("AGENTS.md");

  assert.match(
    content,
    /main agent[\s\S]{0,160}(orchestrat|delegat)/i,
    "AGENTS.md must define the main agent as orchestration-only",
  );
  assert.match(
    content,
    /main agent[\s\S]{0,320}(must not|does not|never)[\s\S]{0,160}(edit|write|modify)[\s\S]{0,160}(product code|tests)/i,
    "AGENTS.md must prohibit the main agent from editing product code or tests",
  );
  assert.match(
    content,
    /(at most|no more than|only)\s+(one|1)\s+(write-capable|writing|write|writer)[\s\S]{0,120}(subagent|agent|at a time|concurrent)/i,
    "AGENTS.md must permit at most one write-capable subagent at a time",
  );
  assert.match(
    content,
    /Sol is reserved for main orchestration[\s\S]{0,180}(Luna|gpt-5\.6-luna)[\s\S]{0,80}(Terra|gpt-5\.6-terra)/i,
    "AGENTS.md must reserve Sol for main orchestration and limit subagents to Luna or Terra",
  );
  assert.match(
    content,
    /Goal Card[\s\S]{0,360}goal[\s\S]{0,120}changed boundary[\s\S]{0,120}risk tier[\s\S]{0,120}owner[\s\S]{0,160}required tests\/evidence[\s\S]{0,160}exit condition/i,
    "AGENTS.md must define fixed Goal Card fields",
  );
  assert.match(
    content,
    /small, single-boundary[\s\S]{0,160}one implementation agent[\s\S]{0,160}necessary deterministic tests/i,
    "AGENTS.md must permit one owner for a low-risk boundary",
  );
  assert.match(
    content,
    /Persistence, migrations, concurrency, recovery, security, or cross-boundary[\s\S]{0,160}independent RED[\s\S]{0,120}verifier-reviewer/i,
    "AGENTS.md must require independent RED and review for high-risk changes",
  );
  assert.match(
    content,
    /test-author[\s\S]{0,120}unit[\s\S]{0,40}integration[\s\S]{0,40}system RED/i,
    "AGENTS.md must assign unit, integration, and system RED work to test-author",
  );
  assert.match(
    content,
    /e2e-verifier[\s\S]{0,120}Playwright RED[\s\S]{0,80}E2E evidence[\s\S]{0,80}(diagnosis|diagnoses)/i,
    "AGENTS.md must assign Playwright RED, E2E evidence, and diagnosis to e2e-verifier",
  );
});

test("v0.4 source snapshot has the exact artifacts and matching SHA256SUMS", () => {
  const sourceDirectory = requireDirectory("docs/source/v0.4");
  const actualFiles = readdirSync(sourceDirectory)
    .filter((fileName) => statSync(path.join(sourceDirectory, fileName)).isFile())
    .sort();
  const expectedFiles = [...Object.keys(sourceArtifacts), "SHA256SUMS"].sort();
  assert.deepEqual(actualFiles, expectedFiles);

  const manifest = requireFile("docs/source/v0.4/SHA256SUMS");
  const manifestEntries = new Map(
    manifest
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
        assert.ok(match, `invalid SHA256SUMS line: ${line}`);
        return [match[2], match[1].toLowerCase()];
      }),
  );
  assert.deepEqual([...manifestEntries.keys()].sort(), Object.keys(sourceArtifacts).sort());

  for (const [fileName, expectedHash] of Object.entries(sourceArtifacts)) {
    const actualHash = sha256(path.join(sourceDirectory, fileName));
    assert.equal(actualHash, expectedHash, `${fileName} differs from the v0.4 source artifact`);
    assert.equal(
      manifestEntries.get(fileName),
      expectedHash,
      `SHA256SUMS does not match ${fileName}`,
    );
  }
});

test("M0 planning directory contains the four required Markdown skeletons", () => {
  const requiredSkeletons = [
    "acceptance.md",
    "implementation-plan.md",
    "retrospective.md",
    "rollout.md",
  ];

  for (const fileName of requiredSkeletons) {
    const content = requireFile(`docs/plans/M0/${fileName}`);
    assert.match(content, /^#\s+\S/m, `${fileName} must contain a Markdown title`);
  }
});

test("make verify-m0 is registered as the non-placeholder PR7 acceptance gate", () => {
  const makefile = requireFile("Makefile");
  assert.match(makefile, /^support-bundle:/m, "PR7 must register support-bundle");
  assert.doesNotMatch(makefile, /verify-m0:[\s\S]{0,200}(?:placeholder|full M0 acceptance is not implemented)/i);
  const result = spawnSync("make", ["--no-print-directory", "-n", "verify-m0"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("reusable M0 acceptance uses the pinned read-only Node and pnpm toolchain", () => {
  const workflow = requireFile(".github/workflows/m0-acceptance.yml");
  const actions = [...workflow.matchAll(/^\s*uses:\s*actions\/(checkout|setup-node)@([^\s#]+)\s*$/gm)]
    .map((match) => ({ name: match[1], version: match[2] }));

  assert.deepEqual(
    {
      missing: ["checkout", "setup-node"].filter(
        (name) => !actions.some((action) => action.name === name),
      ),
      outdated: actions
        .filter((action) => !/^[a-f0-9]{40}$/u.test(action.version))
        .map((action) => `${action.name}@${action.version}`),
    },
    { missing: [], outdated: [] },
  );
  assert.match(workflow, /^permissions:\s*\n\s+contents:\s+read\s*$/m);
  assert.match(workflow, /uses:\s*actions\/setup-node@[a-f0-9]{40}[\s\S]{0,120}node-version:\s*22/);
  assert.match(workflow, /corepack enable && corepack prepare pnpm@11\.13\.0 --activate/);
  assert.match(workflow, /pnpm install --frozen-lockfile/);
});
