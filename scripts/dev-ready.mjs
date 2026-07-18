import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

export async function waitForReady({
  url,
  deadlineAt,
  now = Date.now,
  request = fetch,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  const remaining = deadlineAt - now();
  if (remaining <= 0) {
    throw new Error("Startup deadline exceeded before the readiness check; run pnpm logs.");
  }

  const controller = new AbortController();
  const timer = setTimeoutFn(() => controller.abort(), remaining);
  let response;
  try {
    response = await request(url, { signal: controller.signal });
  } catch {
    if (controller.signal.aborted || now() >= deadlineAt) {
      throw new Error("Startup deadline exceeded during the readiness check; run pnpm logs.");
    }
    throw new Error(`Readiness request failed for ${url}; run pnpm logs.`);
  } finally {
    clearTimeoutFn(timer);
  }

  if (!response.ok) {
    throw new Error(`Readiness check returned HTTP ${response.status}; run pnpm logs.`);
  }
}

function defaultPort() {
  const match = /^APP_PORT=(\d+)$/mu.exec(readFileSync(".env.example", "utf8"));
  return match?.[1] ?? "3000";
}

async function main() {
  const port = process.env.APP_PORT || defaultPort();
  const url = `http://127.0.0.1:${port}`;
  const configuredDeadline = Number(process.env.WORKFLOW_DEV_DEADLINE_AT);
  const deadlineAt = Number.isFinite(configuredDeadline) ? configuredDeadline : Date.now() + 30_000;

  try {
    await waitForReady({ url: `${url}/api/health/ready`, deadlineAt });
    console.log(`Workflow ready: ${url}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Readiness check failed; run pnpm logs.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
