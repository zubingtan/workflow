import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * T5 (#116 #121): Dockerfile + .dockerignore structural invariants.
 *
 * Dockerfile is declarative config, not runtime code — we can't drive it via
 * `app.fetch()` like T4. Instead, these tests pin the structural decisions
 * from D5 so a careless edit doesn't silently break the production image:
 *
 *   1. Base image is pinned to a specific Node 22.x slim tag (not rolling).
 *   2. Multi-stage build (builder produces dist/, runner copies it).
 *   3. pnpm via corepack (not `npm install -g pnpm`).
 *   4. `--frozen-lockfile` on all install steps (reproducible builds).
 *   5. `pnpm-workspace.yaml` + `patches/` are COPYed before install
 *      (without them, pnpm 11 refuses to run better-sqlite3's build script
 *      and the patched @flowgram.ai/runtime-js patch won't apply).
 *   6. Runner stage copies `dist/` from builder, `node_modules` from prod-deps.
 *   7. `NODE_ENV=production` is set in the runner.
 *   8. `WORKFLOW_DATA_DIR` is set (so data persists via a mount, not /root).
 *   9. `CMD ["node", "server/index.mjs"]` (not `pnpm server` — that needs .env).
 *  10. `.dockerignore` excludes .env, .worktrees, node_modules, dist, .git.
 *  11. `EXPOSE 4000` (prod default PORT per map #133 D1; dev=:4001, E2E=:4099).
 *
 * A real `docker build` + `docker run` smoke test is out of scope here — it
 * needs a Docker daemon and is better suited to a CI job. These structural
 * tests catch the "forgot to copy patches/" / "used rolling tag" / "CMD uses
 * pnpm server" classes of mistake before they reach CI.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DOCKERFILE_PATH = resolve(REPO_ROOT, "Dockerfile");
const DOCKERIGNORE_PATH = resolve(REPO_ROOT, ".dockerignore");

function readDockerfile() {
  if (!existsSync(DOCKERFILE_PATH)) {
    throw new Error(`Dockerfile not found at ${DOCKERFILE_PATH}`);
  }
  return readFileSync(DOCKERFILE_PATH, "utf8");
}

function readDockerignore() {
  if (!existsSync(DOCKERIGNORE_PATH)) {
    throw new Error(`.dockerignore not found at ${DOCKERIGNORE_PATH}`);
  }
  return readFileSync(DOCKERIGNORE_PATH, "utf8");
}

test("Dockerfile exists", () => {
  const content = readDockerfile();
  assert.ok(content.length > 0, "Dockerfile must not be empty");
});

test("base image is pinned to node:22.<patch>-bookworm-slim (not rolling tag)", () => {
  const content = readDockerfile();
  // Must pin to a specific 22.x patch version, e.g. node:22.23.1-bookworm-slim.
  // Rejects rolling tags like node:22-slim, node:22, node:latest.
  const fromLines = content.match(/^FROM\s+.+$/gm) ?? [];
  assert.ok(fromLines.length >= 3, `expected multi-stage (≥3 FROM), got ${fromLines.length}`);

  const baseImageLine = fromLines[0];
  const match = baseImageLine.match(/node:(\d+\.\d+\.\d+)-bookworm-slim/);
  assert.ok(
    match,
    `base image must be node:<major>.<minor>.<patch>-bookworm-slim, got: ${baseImageLine}`
  );
  assert.equal(match[1].split(".")[0], "22", "base image major must be 22");
});

test("uses slim base (not alpine, not full bookworm) for the base stage", () => {
  const content = readDockerfile();
  const fromLines = content.match(/^FROM\s+.+$/gm) ?? [];
  assert.ok(fromLines.length >= 3, `expected multi-stage (≥3 FROM), got ${fromLines.length}`);
  // The first FROM must pin node:<ver>-bookworm-slim. Later stages may `FROM base AS ...`.
  const baseFrom = fromLines[0];
  assert.match(
    baseFrom,
    /node:\d+\.\d+\.\d+-bookworm-slim/,
    `base stage must use node:<ver>-bookworm-slim (alpine breaks better-sqlite3 prebuilt fallback; full bookworm is too large), got: ${baseFrom}`
  );
  // No stage may use alpine.
  for (const line of fromLines) {
    assert.doesNotMatch(
      line,
      /alpine/,
      `no stage may use alpine (better-sqlite3 musl prebuilt is fragile), got: ${line}`
    );
  }
});

test("enables corepack for pnpm (not `npm install -g pnpm`)", () => {
  const content = readDockerfile();
  assert.match(content, /corepack enable/, "must enable corepack");
  assert.doesNotMatch(
    content,
    /npm install -g pnpm/,
    "must NOT `npm install -g pnpm` — corepack reads packageManager from package.json"
  );
});

/**
 * Strip comment lines (lines whose first non-space char is #) so tests match
 * only actual Dockerfile instructions.
 */
function stripComments(content) {
  return content
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

test("pnpm install uses --frozen-lockfile everywhere", () => {
  const content = stripComments(readDockerfile());
  const installLines = content.match(/^.*pnpm install.*$/gm) ?? [];
  assert.ok(installLines.length >= 2, `expected ≥2 install steps (prod + full), got ${installLines.length}`);
  for (const line of installLines) {
    assert.ok(
      /--frozen-lockfile/.test(line),
      `every pnpm install must use --frozen-lockfile, got: ${line}`
    );
  }
});

test("copies pnpm-workspace.yaml + patches/ before pnpm install", () => {
  const content = stripComments(readDockerfile());
  // pnpm-workspace.yaml carries allowBuilds (better-sqlite3) + patchedDependencies.
  // patches/ is referenced by patchedDependencies. Both must be present at install time.
  const workspaceCopyIdx = content.search(/^COPY\s+.*pnpm-workspace\.yaml/m);
  const patchesCopyIdx = content.search(/^COPY\s+patches\/\s+\.\/patches\//m);
  const firstInstallIdx = content.indexOf("pnpm install");

  assert.ok(workspaceCopyIdx > -1, "must COPY pnpm-workspace.yaml");
  assert.ok(patchesCopyIdx > -1, "must COPY patches/ directory");
  assert.ok(firstInstallIdx > -1, "must have a pnpm install step");
  assert.ok(
    workspaceCopyIdx < firstInstallIdx,
    "pnpm-workspace.yaml must be COPYed BEFORE first pnpm install"
  );
  assert.ok(
    patchesCopyIdx < firstInstallIdx,
    "patches/ must be COPYed BEFORE first pnpm install"
  );
});

test("has a builder stage that runs pnpm build", () => {
  const content = readDockerfile();
  assert.match(content, /pnpm build/, "builder stage must run `pnpm build` to produce dist/");
  assert.doesNotMatch(content, /pnpm build:prod/, "must NOT use old `pnpm build:prod` — renamed to `pnpm build` (map #133 D5)");
});

test("runner stage copies dist/ from builder", () => {
  const content = readDockerfile();
  // `COPY --from=<builder> /app/dist ./dist` — the builder name varies, so
  // just assert that dist is copied from some prior stage.
  assert.match(
    content,
    /COPY\s+--from=\S+\s+\/app\/dist\s+\.\/dist/,
    "runner must COPY dist/ from a builder stage (rsbuild output)"
  );
});

test("runner stage copies node_modules from a prod-deps stage (not from builder)", () => {
  const content = stripComments(readDockerfile());
  // Must NOT copy node_modules from the full-install builder (it'd bring devDeps).
  // Must copy from a dedicated prod-deps stage.
  assert.match(
    content,
    /COPY\s+--from=\S*prod\S*\s+\/app\/node_modules\s+\.\/node_modules/,
    "runner must COPY node_modules from a prod-deps stage (not the full builder, which has devDeps)"
  );
});

test("runner sets NODE_ENV=production", () => {
  const content = readDockerfile();
  assert.match(content, /ENV\s+NODE_ENV=production/, "runner must set NODE_ENV=production");
});

test("runner sets WORKFLOW_DATA_DIR to a mountable path (not /root/.config/workflow)", () => {
  const content = readDockerfile();
  // Default would put SQLite at /root/.config/workflow — gone on container rebuild.
  // Must override to a path that docker-compose can bind-mount.
  assert.match(
    content,
    /ENV\s+WORKFLOW_DATA_DIR=\/app\/data/,
    "runner must set WORKFLOW_DATA_DIR=/app/data so a volume mount can persist SQLite"
  );
});

test("CMD runs node directly (not `pnpm server` — that needs .env file)", () => {
  const content = readDockerfile();
  assert.match(
    content,
    /CMD\s+\[\s*"node",\s*"server\/index\.mjs"\s*\]/,
    'CMD must be ["node", "server/index.mjs"] — `pnpm server` uses --env-file=.env which containers should not have'
  );
  assert.doesNotMatch(
    content,
    /CMD\s+\[\s*"pnpm"/,
    "CMD must NOT use pnpm wrapper (env-file dependency)"
  );
});

test("EXPOSE 4000 (prod default port, map #133 D1)", () => {
  const content = readDockerfile();
  assert.match(content, /EXPOSE\s+4000/, "must EXPOSE 4000 (prod default PORT, map #133 D1)");
  assert.doesNotMatch(content, /EXPOSE\s+4001/, "must NOT EXPOSE 4001 — that's the dev port now, not prod");
});

test(".dockerignore excludes sensitive paths", () => {
  const content = readDockerignore();
  const required = [".env", ".worktrees", "node_modules", "dist", ".git", "e2e"];
  for (const path of required) {
    assert.ok(
      content.split("\n").some((line) => line.trim() === path || line.trim().startsWith(path + "/")),
      `.dockerignore must exclude ${path}`
    );
  }
});

test(".dockerignore does NOT exclude paths needed for build", () => {
  const content = readDockerignore();
  const mustKeep = ["server", "src", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "patches", "rsbuild.config.ts", "tsconfig.json", "index.html"];
  for (const path of mustKeep) {
    const line = content.split("\n").find((l) => l.trim() === path || l.trim().startsWith(path + "/"));
    assert.ok(
      !line || line.trim().startsWith("#"),
      `.dockerignore must NOT exclude ${path} (needed for build)`
    );
  }
});

// --- mem0 extension packaging (#212 D15) ---

test("build stage builds the pi-extension-mem0 workspace package", () => {
  const content = readDockerfile();
  assert.match(
    content,
    /pnpm --filter @flowgram\.ai\/pi-extension-mem0 build/,
    "build stage must build the extension (tsup → packages/pi-extension-mem0/dist)"
  );
});

test("runner stage copies the extension dist to /opt/pi-extension-mem0", () => {
  const content = readDockerfile();
  assert.match(
    content,
    /COPY --from=build \/app\/packages\/pi-extension-mem0\/dist \/opt\/pi-extension-mem0/,
    "runner must install the extension at /opt/pi-extension-mem0 (D15)"
  );
});
