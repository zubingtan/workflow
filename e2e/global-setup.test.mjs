import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E global-setup invariants (map #133 — unified dev/prod experience).
 *
 * E2E runs in prod mode on isolated ports (D3/D4):
 *   - Hono server  (port 4099)  — NODE_ENV=production, PORT=4099
 *   - fake-provider (port 4011) — FAKE_PROVIDER_PORT=4011
 *
 * `pnpm build` produces `dist/`, then `NODE_ENV=production PORT=4099
 * node server/index.mjs` serves SPA + API + SSE on a single port :4099 via
 * serveStatic + SPA fallback. global-teardown kills the two process groups.
 *
 * These tests pin the structural invariants so a careless edit doesn't
 * silently regress to the old three-process dev-mode setup or the old port
 * scheme (dev=:4001, E2E=:4001, fake=:4010):
 *
 *   1. Only `fake` and `server` children are spawned (no `web`).
 *   2. The server is started in prod mode (NODE_ENV=production) — this is
 *      what enables serveStatic + SPA fallback.
 *   3. The server is started via `node server/index.mjs` (NOT `pnpm server`,
 *      which passes `--env-file=.env` and would conflict with E2E's env).
 *   4. `PUBLIC_SERVER_URL` is NOT injected (T3 removed it; prod build doesn't
 *      need it because `src/api.ts` uses same-origin relative paths).
 *   5. waitForUrl targets `http://localhost:4099` (E2E-only port, not dev :4001).
 *   6. `MODE=app` / `NODE_ENV=development` / `rsbuild dev` references are
 *      gone — they belong to the dev-mode setup that E2E no longer uses.
 *   7. Server env uses `PORT` (not the deprecated `SERVER_PORT`).
 *   8. fake-provider uses port 4011 (E2E-isolated, not dev 4010).
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
  assert.doesNotMatch(
    content,
    /spawnLogged\(\s*['"]web['"]/,
    "must NOT spawn a `web` child — prod-mode E2E serves SPA via Hono serveStatic"
  );
  assert.doesNotMatch(
    content,
    /\.bin[\\/]rsbuild/,
    "must NOT resolve the rsbuild binary — prod-mode E2E uses pre-built dist/, not a dev server"
  );
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
  assert.match(
    content,
    /NODE_ENV:\s*['"]production['"]/,
    "server child must set NODE_ENV=production (enables serveStatic + SPA fallback)"
  );
  assert.doesNotMatch(
    content,
    /NODE_ENV:\s*['"]development['"]/,
    "must NOT set NODE_ENV=development on any child — that disables serveStatic"
  );
});

test("server child is started via `node server/index.mjs` (NOT pnpm server)", () => {
  const content = readSetup();
  assert.match(
    content,
    /spawnLogged\(\s*['"]server['"]\s*,\s*['"]node['"]\s*,\s*\[\s*['"]server\/index\.mjs['"]\s*\]/,
    "server must be spawned as `node server/index.mjs` (direct invocation, not pnpm wrapper)"
  );
});

test("does NOT inject PUBLIC_SERVER_URL (T3 removed it)", () => {
  const content = readSetup();
  assert.doesNotMatch(
    content,
    /PUBLIC_SERVER_URL/,
    "must NOT inject PUBLIC_SERVER_URL — T3 removed it; prod build uses same-origin relative paths"
  );
});

test("does NOT inject MODE=app (that's a dev-rsbuild-only env var)", () => {
  const content = readSetup();
  assert.doesNotMatch(
    content,
    /MODE:\s*['"]app['"]/,
    "must NOT inject MODE=app — that's a dev-rsbuild env var; prod-mode E2E serves pre-built dist/"
  );
});

test("waitForUrl targets http://localhost:4099 (E2E-isolated port)", () => {
  const content = readSetup();
  // E2E uses :4099 (map #133 D3) so it can run concurrently with dev (:4001) and prod (:4000).
  assert.match(
    content,
    /waitForUrl\(\s*['"]http:\/\/localhost:4099[^'"]*['"]/,
    "must wait for http://localhost:4099 (E2E-isolated Hono port serving SPA + API)"
  );
  // Must NOT wait on :3000 (old rsbuild dev port) or :4001 (dev port).
  assert.doesNotMatch(
    content,
    /waitForUrl\(\s*['"]http:\/\/localhost:3000/,
    "must NOT wait on http://localhost:3000 — that was the rsbuild dev port, no longer spawned"
  );
});

test("server env uses PORT (not deprecated SERVER_PORT)", () => {
  const content = readSetup();
  assert.match(
    content,
    /PORT:\s*['"]4099['"]/,
    "server child must set PORT=4099 (map #133 D1/D3 — PORT replaces SERVER_PORT)"
  );
  assert.doesNotMatch(
    content,
    /SERVER_PORT/,
    "must NOT reference SERVER_PORT — deprecated in favor of PORT (map #133 D1)"
  );
});

test("fake-provider env uses port 4011 (E2E-isolated, not dev 4010)", () => {
  const content = readSetup();
  assert.match(
    content,
    /FAKE_PROVIDER_PORT:\s*['"]4011['"]/,
    "fake-provider must use port 4011 (E2E-isolated per map #133 D4)"
  );
  assert.doesNotMatch(
    content,
    /FAKE_PROVIDER_PORT:\s*['"]4010['"]/,
    "must NOT use 4010 for E2E — that's the dev fake-provider port"
  );
});

test("processes object only has fake + server keys (NO web)", () => {
  const content = readSetup();
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

test("playwright.config.ts baseURL points at the E2E port :4099", () => {
  const content = readPlaywrightConfig();
  assert.match(
    content,
    /baseURL:\s*['"]http:\/\/localhost:4099['"]/,
    "playwright.config.ts baseURL must be http://localhost:4099 (E2E-isolated Hono port)"
  );
  assert.doesNotMatch(
    content,
    /baseURL:\s*['"]http:\/\/localhost:(3000|4001)['"]/,
    "playwright.config.ts baseURL must NOT be :3000 or :4001 (old/dev ports)"
  );
});
