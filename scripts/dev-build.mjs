import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

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

const requestedPort = process.env.APP_PORT;
const requestedImageTag = process.env.WORKFLOW_IMAGE_TAG;
const environment = { ...process.env, ...safeDefaults() };
if (requestedPort) environment.APP_PORT = requestedPort;
if (requestedImageTag) environment.WORKFLOW_IMAGE_TAG = requestedImageTag;

const started = spawnSync("docker", [
  "compose", "--env-file", ".env.example",
  "up", "-d", "--build", "--wait", "--wait-timeout", "30",
], { env: environment, stdio: "inherit" });

if (started.status !== 0) process.exit(started.status ?? 1);
const ready = spawnSync(process.execPath, ["scripts/dev-ready.mjs"], {
  env: environment,
  stdio: "inherit",
});
process.exitCode = ready.status ?? 1;
