import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const deadlineAt = Date.now() + 30_000;

function safeDefaults() {
  const values = {};
  for (const rawLine of readFileSync(".env.example", "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

const requestedPort = process["env"].APP_PORT;
const requestedImageTag = process["env"].WORKFLOW_IMAGE_TAG;
const environment = { ...process["env"], ...safeDefaults() };
if (requestedPort) environment.APP_PORT = requestedPort;
if (requestedImageTag) environment.WORKFLOW_IMAGE_TAG = requestedImageTag;

const waitTimeout = Math.floor((deadlineAt - Date.now()) / 1_000);
if (waitTimeout < 1) {
  console.error("Startup deadline exceeded before Compose could start; run pnpm doctor.");
  process.exit(1);
}

const composeArguments = [
  "compose", "--env-file", ".env.example",
  "up", "-d", "--wait", "--wait-timeout", "30", "--no-build",
];
composeArguments[composeArguments.indexOf("--wait-timeout") + 1] = String(waitTimeout);
const started = spawnSync("docker", composeArguments, { env: environment, stdio: "inherit" });

if (started.status !== 0) {
  console.error("Local stack failed to become healthy; run pnpm setup or pnpm logs.");
  process.exit(started.status ?? 1);
}
const ready = spawnSync(process.execPath, ["scripts/dev-ready.mjs"], {
  env: { ...environment, WORKFLOW_DEV_DEADLINE_AT: String(deadlineAt) },
  stdio: "inherit",
});
process.exitCode = ready.status ?? 1;
