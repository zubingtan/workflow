/**
 * Playwright global setup.
 *
 * Spawns two long-running processes directly (not via pnpm wrapper, to keep
 * process-group management clean):
 *   - fake-provider (port 4010) — node scripts/fake-provider.mjs
 *   - Hono server  (port 4001)  — node server/index.mjs in PROD mode
 *
 * After T1-T6 (#116), the unified prod-mode startup is the simplest correct
 * E2E path: `pnpm build:prod` produces `dist/`, then `NODE_ENV=production
 * node server/index.mjs` serves SPA + API + SSE on a single port :4001 via
 * T4's `serveStatic` + SPA fallback. The rsbuild `middlewareMode` dev-mode
 * integration (T1 #117) was decision-only and never implemented, so we
 * don't try to run a dev server here.
 *
 * Each child is `detached: true` so it becomes its own process-group leader,
 * letting global-teardown kill the whole group via process.kill(-pid).
 * Output is tee'd to e2e/.logs/*.log for debugging.
 *
 * Polls each until ready (timeout 60s), then stashes the child processes on
 * `globalThis` so global-teardown can kill them.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, writeSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const LOG_DIR = join(ROOT, 'e2e', '.logs');
mkdirSync(LOG_DIR, { recursive: true });

const DATA_DIR = mkdtempSync(join(tmpdir(), 'workflow-e2e-'));
const READY_TIMEOUT = 60_000;
const POLL_INTERVAL = 250;

const processes: { fake?: ChildProcess; server?: ChildProcess } = {};
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
 * We do NOT run `pnpm build:prod` automatically — that's a 30s+ operation
 * and the user is expected to have run it (or `pnpm dev` to refresh dist/).
 * If dist/ is missing we fail fast with a clear message.
 */
function assertDistExists() {
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir) || !existsSync(join(distDir, 'index.html'))) {
    throw new Error(
      `E2E needs dist/ with index.html (prod-mode startup). Run \`pnpm build:prod\` first.\n` +
        `  expected: ${join(distDir, 'index.html')}`
    );
  }
}

export default async function globalSetup() {
  // Build a clean env for the children. We load .env ourselves (rather than
  // relying on `node --env-file=.env`) so we control precedence — the E2E
  // overrides below must win over whatever's in .env.
  //
  // Playwright does NOT auto-load .env, so process.env may be missing the
  // FAKE_PROVIDER_API_KEY that the server needs to resolve agent credentials
  // (server does process.env[agent.provider_api_key_env] at call time). We set
  // it explicitly on both fake-provider and server below.
  const baseEnv = { ...process.env };
  const fakeApiKey = baseEnv.FAKE_PROVIDER_API_KEY ?? 'fake-provider-local';

  // --- fake-provider (port 4010) ---
  processes.fake = spawnLogged('fake-provider', 'node', ['scripts/fake-provider.mjs'], {
    ...baseEnv,
    FAKE_PROVIDER_API_KEY: fakeApiKey,
    FAKE_PROVIDER_PORT: baseEnv.FAKE_PROVIDER_PORT ?? '4010',
  });
  await waitForUrl('http://localhost:4010/health/live', 'fake-provider', 'fake-provider');

  // --- Hono server (port 4001) in PROD mode with isolated SQLite ---
  // Prod mode (NODE_ENV=production) enables T4's serveStatic + SPA fallback,
  // so this single process serves the SPA bundle (from dist/) AND the API/SSE.
  // We invoke `node server/index.mjs` directly (not `pnpm server`) so E2E
  // owns env precedence — `pnpm server` passes `--env-file=.env` which would
  // override WORKFLOW_DATA_DIR and FAKE_PROVIDER_API_KEY.
  //
  // The server resolves API keys via process.env[agent.provider_api_key_env]
  // at call time — seeded agents use FAKE_PROVIDER_API_KEY as the env-var
  // name, so the server MUST have it in its env or execution fails with
  // "missing env var: FAKE_PROVIDER_API_KEY".
  assertDistExists();
  processes.server = spawnLogged('server', 'node', ['server/index.mjs'], {
    ...baseEnv,
    FAKE_PROVIDER_API_KEY: fakeApiKey,
    WORKFLOW_DATA_DIR: DATA_DIR, // override ~/.config/workflow/ → temp dir
    SERVER_PORT: baseEnv.SERVER_PORT ?? '4001',
    NODE_ENV: 'production', // enables serveStatic + SPA fallback (T4 #120)
  });
  await waitForUrl('http://localhost:4001/health/live', 'Hono server', 'server');

  // eslint-disable-next-line no-console
  console.log(`[e2e] all processes ready; data dir: ${DATA_DIR}`);
}
