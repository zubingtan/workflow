/**
 * Playwright global teardown.
 *
 * Kills the three dev processes spawned by global-setup, in reverse order
 * (web → server → fake). Each was spawned `detached: true` so it's its own
 * process-group leader; we kill the whole group via process.kill(-pid, SIGTERM)
 * to reach grandchildren (e.g. rsbuild's webpack workers).
 *
 * Falls back to a direct process.kill(pid) if the group kill fails (happens
 * if the child already exited or wasn't a group leader for some reason).
 */
import type { ChildProcess } from 'node:child_process';

const processes: { fake?: ChildProcess; server?: ChildProcess; web?: ChildProcess } =
  (globalThis as any).__E2E_PROCESSES__ ?? {};

function killGroup(child: ChildProcess | undefined, label: string) {
  if (!child || child.exitCode !== null) return;
  const pid = child.pid;
  if (pid === undefined) return;
  try {
    // Kill the whole process group (negative pid). SIGTERM lets the children
    // clean up gracefully.
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Group kill can fail with ESRCH if the group already exited, or EPERM
    // if the pid isn't actually a group leader. Fall back to direct kill.
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[e2e teardown] killed ${label} (pid ${pid})`);
}

export default async function globalTeardown() {
  // Reverse order: web first (so no new requests hit the server), then server,
  // then fake-provider.
  killGroup(processes.web, 'web');
  killGroup(processes.server, 'server');
  killGroup(processes.fake, 'fake-provider');

  // Give the OS a moment to release the ports.
  await new Promise((r) => setTimeout(r, 500));
}
