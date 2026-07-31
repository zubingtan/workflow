/**
 * Playwright global setup.
 *
 * Spawns two long-running processes directly (not via pnpm wrapper, to keep
 * process-group management clean):
 *   - fake-provider (port 4011) — node scripts/fake-provider.mjs
 *   - Hono server  (port 4099)  — node server/index.mjs in PROD mode
 *
 * E2E runs in prod mode with fully isolated ports (per map #133 D3/D4):
 * `pnpm build` produces `dist/`, then `NODE_ENV=production PORT=4099
 * node server/index.mjs` serves SPA + API + SSE on a single port :4099 via
 * serveStatic + SPA fallback. Ports :4099 + :4011 are E2E-only so dev
 * (:4001 + :4010) and prod (:4000) can run concurrently.
 *
 * Each child is `detached: true` so it becomes its own process-group leader,
 * letting global-teardown kill the whole group via process.kill(-pid).
 * Output is tee'd to e2e/.logs/*.log for debugging.
 *
 * Polls each until ready (timeout 60s), then stashes the child processes on
 * `globalThis` so global-teardown can kill them.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, writeSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const LOG_DIR = join(ROOT, 'e2e', '.logs');
mkdirSync(LOG_DIR, { recursive: true });

const DATA_DIR = mkdtempSync(join(tmpdir(), 'workflow-e2e-'));
const READY_TIMEOUT = 60_000;
const POLL_INTERVAL = 250;

const processes: { fake?: ChildProcess; server?: ChildProcess; mem0?: ChildProcess } = {};
(globalThis as any).__E2E_PROCESSES__ = processes;
(globalThis as any).__E2E_DATA_DIR__ = DATA_DIR;

/**
 * Spawn a child as its own process-group leader (detached: true), with stdio
 * tee'd to a log file under e2e/.logs/. Returns the ChildProcess.
 *
 * `detached: true` is the key: on Linux the child becomes a session leader,
 * so process.kill(-child.pid) reaches the whole group (including grandchildren
 * like rsbuild's webpack workers). Without it, `shell: true` or pnpm wrappers
 * create a pid that isn't a group leader, and group kill silently fails —
 * leaving orphans that hold the ports and cause the next run to hang.
 */
function spawnLogged(
  name: string,
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv
): ChildProcess {
  const logPath = join(LOG_DIR, `${name}.log`);
  const logFd = openSync(logPath, 'w');
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env,
    detached: true, // own process group → teardown can kill -pid
    stdio: ['ignore', logFd, logFd], // stdout+stderr → log file
  });
  child.on('error', (err) => {
    // Surface spawn errors to the log file too.
    try {
      writeSync(logFd, `[spawn error] ${err.message}\n`);
    } catch {
      /* ignore */
    }
  });
  // Don't hold the parent event loop open waiting on the child.
  child.unref();
  return child;
}

async function waitForUrl(url: string, label: string, logName: string): Promise<void> {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < READY_TIMEOUT) {
    try {
      const res = await fetch(url);
      // 200 = healthy; 404 = server up, path just doesn't match (fine for dev server root)
      if (res.ok || res.status === 404) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
  // Dump the tail of the log so the failure reason is visible inline.
  let logTail = '';
  try {
    logTail = readFileSync(join(LOG_DIR, `${logName}.log`), 'utf8').slice(-2000);
  } catch {
    /* log may not exist */
  }
  throw new Error(
    `${label} did not become ready at ${url} within ${READY_TIMEOUT}ms (last error: ${lastErr})\n` +
      `--- ${logName}.log (tail) ---\n${logTail}`
  );
}

/**
 * Ensure `dist/` exists before we start the server in prod mode. The server
 * reads `STATIC_DIR` (defaults to `./dist`); if it's missing, the SPA root
 * returns 404 and every page.goto('/') in the test suite fails confusingly.
 *
 * We do NOT run `pnpm build` automatically — that's a 30s+ operation
 * and the user is expected to have run it (or `pnpm dev` to refresh dist/).
 * If dist/ is missing we fail fast with a clear message.
 */
function assertDistExists() {
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir) || !existsSync(join(distDir, 'index.html'))) {
    throw new Error(
      `E2E needs dist/ with index.html (prod-mode startup). Run \`pnpm build\` first.\n` +
        `  expected: ${join(distDir, 'index.html')}`
    );
  }
}

/**
 * Ensure the mem0 extension dist exists before the server starts (spec #212
 * D15). The server symlinks {agentDir}/extensions/pi-extension-mem0/ from
 * packages/pi-extension-mem0/dist; without it the extension never loads and
 * the mem0 E2E suite fails at auto-capture. CI runs `pnpm build` (frontend
 * only), so we build the extension on demand — fast, idempotent, and keeps
 * the E2E command single-step in every environment.
 */
function ensureMem0ExtensionDist() {
  const distEntry = join(ROOT, 'packages', 'pi-extension-mem0', 'dist', 'index.js');
  if (existsSync(distEntry)) return;
  execSync('pnpm --filter @flowgram.ai/pi-extension-mem0 build', {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

export default async function globalSetup() {
  // Build a clean env for the children. We load .env ourselves (rather than
  // relying on `node --env-file=.env`) so we control precedence — the E2E
  // overrides below must win over whatever's in .env.
  //
  // Playwright does NOT auto-load .env, so process.env may be missing
  // FAKE_PROVIDER_API_KEY. fake-provider needs it to validate request
  // Authorization headers. The server reads agent API keys from the DB
  // (agent.provider_api_key, set by seedAgentIfEmpty) — it does NOT resolve
  // env vars for credentials anymore. We still pass FAKE_PROVIDER_API_KEY to
  // both processes for simplicity (harmless on the server side).
  const baseEnv = { ...process.env };
  const fakeApiKey = baseEnv.FAKE_PROVIDER_API_KEY ?? 'fake-provider-local';

  // --- fake-provider (E2E port 4011, per map #133 D4) ---
  processes.fake = spawnLogged('fake-provider', 'node', ['scripts/fake-provider.mjs'], {
    ...baseEnv,
    FAKE_PROVIDER_API_KEY: fakeApiKey,
    FAKE_PROVIDER_PORT: '4011',
  });
  await waitForUrl('http://localhost:4011/health/live', 'fake-provider', 'fake-provider');

  // --- fake mem0 server (E2E port 8890, per spec #212 user story 11) ---
  // Isolated from any locally running mem0 instance. The server process will
  // be pointed at it via the mem0_host setting configured in E2E specs.
  processes.mem0 = spawnLogged('fake-mem0', 'node', ['scripts/fake-mem0-server.mjs'], {
    ...baseEnv,
    FAKE_MEM0_PORT: '8890',
    MEM0_API_KEY: 'e2e-mem0-key',
  });
  await waitForUrl('http://localhost:8890/health/live', 'fake-mem0', 'fake-mem0');

  // --- Hono server (E2E port 4099, per map #133 D3) in PROD mode with isolated SQLite ---
  // Prod mode (NODE_ENV=production) enables serveStatic + SPA fallback,
  // so this single process serves the SPA bundle (from dist/) AND the API/SSE.
  // We invoke `node server/index.mjs` directly (not `pnpm server`) so E2E
  // owns env precedence — `pnpm server` passes `--env-file=.env` which would
  // override WORKFLOW_DATA_DIR and FAKE_PROVIDER_API_KEY.
  //
  // The server reads agent API keys from the DB directly (agent.provider_api_key,
  // seeded with the literal value "fake-provider-local"). It no longer resolves
  // env vars for credentials. FAKE_PROVIDER_API_KEY is still passed because
  // fake-provider uses it to validate Authorization headers on requests from
  // the server.
  assertDistExists();
  ensureMem0ExtensionDist();
  processes.server = spawnLogged('server', 'node', ['server/index.mjs'], {
    ...baseEnv,
    FAKE_PROVIDER_API_KEY: fakeApiKey,
    WORKFLOW_DATA_DIR: DATA_DIR, // override ~/.config/workflow/ → temp dir
    PORT: '4099', // E2E-only port (map #133 D3); dev=4001, prod=4000
    NODE_ENV: 'production', // enables serveStatic + SPA fallback
  });
  await waitForUrl('http://localhost:4099/health/live', 'Hono server', 'server');

  // eslint-disable-next-line no-console
  console.log(`[e2e] all processes ready; data dir: ${DATA_DIR}`);
}
