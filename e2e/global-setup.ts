/**
 * Playwright global setup.
 *
 * Spawns three long-running dev processes directly (not via pnpm wrapper, to
 * keep process-group management clean):
 *   - fake-provider (port 4010) — node scripts/fake-provider.mjs
 *   - Hono server (port 4001)   — node server/index.mjs (WORKFLOW_DATA_DIR → temp)
 *   - rsbuild dev (port 3000)   — rsbuild dev (NO --open; playwright owns its browser)
 *
 * Each child is `detached: true` so it becomes its own process-group leader,
 * letting global-teardown kill the whole group via process.kill(-pid).
 * Output is tee'd to e2e/.logs/*.log for debugging.
 *
 * Polls each until ready (timeout 60s), then stashes the child processes on
 * `globalThis` so global-teardown can kill them.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, writeSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();
const LOG_DIR = join(ROOT, 'e2e', '.logs');
mkdirSync(LOG_DIR, { recursive: true });

const DATA_DIR = mkdtempSync(join(tmpdir(), 'workflow-e2e-'));
const READY_TIMEOUT = 60_000;
const POLL_INTERVAL = 250;

const processes: { fake?: ChildProcess; server?: ChildProcess; web?: ChildProcess } = {};
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

  // --- Hono server (port 4001) with isolated SQLite ---
  // The server resolves API keys via process.env[agent.provider_api_key_env]
  // at call time — seeded agents use FAKE_PROVIDER_API_KEY as the env-var
  // name, so the server MUST have it in its env or execution fails with
  // "missing env var: FAKE_PROVIDER_API_KEY".
  processes.server = spawnLogged('server', 'node', ['server/index.mjs'], {
    ...baseEnv,
    FAKE_PROVIDER_API_KEY: fakeApiKey,
    WORKFLOW_DATA_DIR: DATA_DIR, // override ~/.config/workflow/ → temp dir
    SERVER_PORT: baseEnv.SERVER_PORT ?? '4001',
  });
  await waitForUrl('http://localhost:4001/health/live', 'Hono server', 'server');

  // --- rsbuild dev (port 3000) WITHOUT --open ---
  // The `pnpm dev` script is `cross-env MODE=app NODE_ENV=development rsbuild dev --open`.
  // For E2E we run rsbuild directly, set the env vars ourselves, and DROP --open
  // (playwright launches its own chromium; an extra external browser tab is
  // noise and can hang headless environments).
  const rsbuildBin = resolve(ROOT, 'node_modules', '.bin', 'rsbuild');
  processes.web = spawnLogged('web', rsbuildBin, ['dev'], {
    ...baseEnv,
    MODE: 'app',
    NODE_ENV: 'development',
    PUBLIC_SERVER_URL: 'http://localhost:4001', // inlined into client bundle
  });
  await waitForUrl('http://localhost:3000', 'rsbuild dev', 'web');

  // eslint-disable-next-line no-console
  console.log(`[e2e] all processes ready; data dir: ${DATA_DIR}`);
}
