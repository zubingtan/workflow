import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

function readEnvironment(file) {
  const values = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("invalid environment assignment");
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const checked = spawnSync(process.execPath, ["scripts/doctor.mjs", "--real"], { stdio: "inherit" });
if (checked.status !== 0) process.exit(1);

let overrides;
try {
  overrides = readEnvironment(".env.local");
} catch {
  console.error("Unable to read .env.local. See config/provider-bindings.example.json for the expected setup.");
  process.exit(1);
}

const localBindings = path.resolve("config/provider-bindings.local.json");
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "workflow-compose-"));
const overrideFile = path.join(temporaryDirectory, "compose.real.yaml");
writeFileSync(overrideFile, [
  "services:",
  "  app:",
  "    volumes:",
  "      - type: bind",
  `        source: ${JSON.stringify(localBindings)}`,
  "        target: /app/config/provider-bindings.local.json",
  "        read_only: true",
  "",
].join("\n"));

const environment = {
  ...process.env,
  ...overrides,
  PROVIDER_BINDINGS_FILE: "config/provider-bindings.local.json",
  PROVIDER_BINDINGS_HOST_FILE: localBindings,
};

try {
  const deadlineAt = Date.now() + 30_000;
  const waitTimeout = Math.floor((deadlineAt - Date.now()) / 1_000);
  const composeArguments = [
    "compose", "--env-file", ".env.example", "--env-file", ".env.local",
    "-f", "compose.yaml", "-f", overrideFile,
    "up", "-d", "--wait", "--wait-timeout", "30", "--no-build",
  ];
  composeArguments[composeArguments.indexOf("--wait-timeout") + 1] = String(waitTimeout);
  const started = spawnSync("docker", composeArguments, { env: environment, stdio: "inherit" });
  if (started.status !== 0) {
    console.error("Real-provider stack failed to become healthy; run pnpm logs.");
    process.exitCode = started.status ?? 1;
  } else {
    const ready = spawnSync(process.execPath, ["scripts/dev-ready.mjs"], {
      env: { ...environment, WORKFLOW_DEV_DEADLINE_AT: String(deadlineAt) },
      stdio: "inherit",
    });
    process.exitCode = ready.status ?? 1;
  }
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
