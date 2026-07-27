import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * T7 (#116 #123): E2E global-setup adapts to the unified prod-mode startup.
 *
 * After T1-T6, dev mode is still split (rsbuild:3000 + Hono:4001 + fake:4010)
 * because T1 (#117) was a decision-only ticket — the rsbuild `middlewareMode`
 * integration was never implemented. The simplest correct E2E path confirmed
 * by D1-D6 is **prod mode**: `pnpm build:prod && NODE_ENV=production node
 * server/index.mjs` serves SPA + API + SSE on a single port :4001.
 *
 * These tests pin the structural invariants so a careless edit doesn't
 * silently regress to the old three-process dev-mode setup:
 *
 *   1. Only `fake` and `server` children are spawned (no `web`).
 *   2. The server is started in prod mode (NODE_ENV=production) — this is
 *      what enables T4's serveStatic + SPA fallback.
 *   3. The server is started via `node server/index.mjs` (NOT `pnpm server`,
 *      which passes `--env-file=.env` and would conflict with E2E's env).
 *   4. `PUBLIC_SERVER_URL` is NOT injected (T3 removed it; prod build doesn't
 *      need it because `src/api.ts` uses same-origin relative paths).
 *   5. waitForUrl targets `http://localhost:4001` (the unified port), NOT
 *      `http://localhost:3000` (the old rsbuild dev port).
 *   6. `MODE=app` / `NODE_ENV=development` / `rsbuild dev` references are
 *      gone — they belong to the dev-mode setup that E2E no longer uses.
 *
 * A real `pnpm test:e2e` smoke test is out of scope for `node --test`
 * (needs playwright + browser) — left to CI / manual verification.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SETUP_PATH = resolve(REPO_ROOT, "e2e", "global-setup.ts");
const TEARDOWN_PATH = resolve(REPO_ROOT, "e2e", "global-teardown.ts");
const PLAYWRIGHT_CONFIG_PATH = resolve(REPO_ROOT, "playwright.config.ts");

function readSetup() {
  if (!existsSync(SETUP_PATH)) {
    throw new Error(`e2e/global-setup.ts not found at ${SETUP_PATH}`);
  }
  return readFileSync(SETUP_PATH, "utf8");
}

function readTeardown() {
  if (!existsSync(TEARDOWN_PATH)) {
    throw new Error(`e2e/global-teardown.ts not found at ${TEARDOWN_PATH}`);
  }
  return readFileSync(TEARDOWN_PATH, "utf8");
}

function readPlaywrightConfig() {
  if (!existsSync(PLAYWRIGHT_CONFIG_PATH)) {
    throw new Error(`playwright.config.ts not found at ${PLAYWRIGHT_CONFIG_PATH}`);
  }
  return readFileSync(PLAYWRIGHT_CONFIG_PATH, "utf8");
}

test("global-setup.ts exists and is non-empty", () => {
  const content = readSetup();
  assert.ok(content.length > 0, "global-setup.ts must not be empty");
});

test("spawns only fake-provider and server (NO rsbuild dev / web child)", () => {
  const content = readSetup();
  // The `web` child (rsbuild dev :3000) is gone in prod-mode E2E.
  // Assert no spawnLogged('web', ...) call and no rsbuild bin resolution.
  assert.doesNotMatch(
    content,
    /spawnLogged\(\s*['"]web['"]/,
    "must NOT spawn a `web` child — prod-mode E2E serves SPA via Hono serveStatic"
  );
  // No rsbuild binary resolution (the `node_modules/.bin/rsbuild` line is the
  // smoking gun of the dev-mode setup). Comments mentioning rsbuild are fine.
  assert.doesNotMatch(
    content,
    /\.bin[\\/]rsbuild/,
    "must NOT resolve the rsbuild binary — prod-mode E2E uses pre-built dist/, not a dev server"
  );
  // The two children that remain:
  assert.match(
    content,
    /spawnLogged\(\s*['"]fake-provider['"]/,
    "must spawn `fake-provider` (still needed for agent execution scenarios)"
  );
  assert.match(
    content,
    /spawnLogged\(\s*['"]server['"]/,
    "must spawn `server` (the unified Hono process)"
  );
});

test("server child is started in prod mode (NODE_ENV=production)", () => {
  const content = readSetup();
  // Prod mode is what enables T4's serveStatic + SPA fallback on the Hono
  // process. Without it, the server has no static routes and `/` returns 404.
  assert.match(
    content,
    /NODE_ENV:\s*['"]production['"]/,
    "server child must set NODE_ENV=production (enables serveStatic + SPA fallback)"
  );
  // Must NOT set NODE_ENV=development on the server child.
  assert.doesNotMatch(
    content,
    /NODE_ENV:\s*['"]development['"]/,
    "must NOT set NODE_ENV=development on any child — that disables serveStatic"
  );
});

test("server child is started via `node server/index.mjs` (NOT pnpm server)", () => {
  const content = readSetup();
  // `pnpm server` passes `--env-file=.env` which would override E2E's env
  // (WORKFLOW_DATA_DIR, FAKE_PROVIDER_API_KEY). Direct node invocation lets
  // global-setup own the env precedence.
  assert.match(
    content,
    /spawnLogged\(\s*['"]server['"]\s*,\s*['"]node['"]\s*,\s*\[\s*['"]server\/index\.mjs['"]\s*\]/,
    "server must be spawned as `node server/index.mjs` (direct invocation, not pnpm wrapper)"
  );
});

test("does NOT inject PUBLIC_SERVER_URL (T3 removed it)", () => {
  const content = readSetup();
  // T3 (#119) removed PUBLIC_SERVER_URL from .env.example and src/api.ts.
  // The prod build inlines src/api.ts (which now uses same-origin relative
  // paths), so injecting PUBLIC_SERVER_URL is dead code AND wrong (it would
  // be inlined into a bundle that's already built).
  assert.doesNotMatch(
    content,
    /PUBLIC_SERVER_URL/,
    "must NOT inject PUBLIC_SERVER_URL — T3 removed it; prod build uses same-origin relative paths"
  );
});

test("does NOT inject MODE=app (that's a dev-rsbuild-only env var)", () => {
  const content = readSetup();
  // MODE=app is read by rsbuild.config.ts to pick the app build target. In
  // prod-mode E2E we serve the already-built dist/, not a dev server, so
  // MODE has no effect and only adds noise.
  assert.doesNotMatch(
    content,
    /MODE:\s*['"]app['"]/,
    "must NOT inject MODE=app — that's a dev-rsbuild env var; prod-mode E2E serves pre-built dist/"
  );
});

test("waitForUrl targets http://localhost:4001 (the unified port)", () => {
  const content = readSetup();
  // The SPA is served by Hono on :4001 in prod mode. The old :3000 target
  // was the rsbuild dev server, which is no longer spawned.
  assert.match(
    content,
    /waitForUrl\(\s*['"]http:\/\/localhost:4001[^'"]*['"]/,
    "must wait for http://localhost:4001 (the unified Hono port serving SPA + API)"
  );
  // Must NOT wait on :3000 (old rsbuild dev port).
  assert.doesNotMatch(
    content,
    /waitForUrl\(\s*['"]http:\/\/localhost:3000/,
    "must NOT wait on http://localhost:3000 — that was the rsbuild dev port, no longer spawned"
  );
});

test("processes object only has fake + server keys (NO web)", () => {
  const content = readSetup();
  // The type annotation and the globalThis assignment should reflect the
  // two-child reality. A stale `web?: ChildProcess` field would be dead
  // code and confuse readers.
  assert.doesNotMatch(
    content,
    /\bweb\b\??:\s*ChildProcess/,
    "must NOT declare a `web` field on the processes object — no web child is spawned"
  );
});

test("global-teardown.ts kills only fake + server (NO web)", () => {
  const content = readTeardown();
  assert.doesNotMatch(
    content,
    /\bweb\b/,
    "global-teardown must NOT reference `web` — no web child exists to kill"
  );
  assert.match(
    content,
    /killGroup\(processes\.server/,
    "teardown must still kill the server process"
  );
  assert.match(
    content,
    /killGroup\(processes\.fake/,
    "teardown must still kill the fake-provider process"
  );
});

test("playwright.config.ts baseURL points at the unified port :4001", () => {
  const content = readPlaywrightConfig();
  // The test scenarios navigate via `page.goto('/')` which resolves against
  // baseURL. In prod-mode E2E, the SPA is on :4001, not :3000.
  assert.match(
    content,
    /baseURL:\s*['"]http:\/\/localhost:4001['"]/,
    "playwright.config.ts baseURL must be http://localhost:4001 (unified Hono port)"
  );
  assert.doesNotMatch(
    content,
    /baseURL:\s*['"]http:\/\/localhost:3000['"]/,
    "playwright.config.ts baseURL must NOT be :3000 (old rsbuild dev port)"
  );
});
