import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

const realMode = process.argv.includes("--real");
let failed = false;

function pass(label) {
  console.log(`[PASS] ${label}`);
}

function fail(label, action) {
  failed = true;
  console.error(`[FAIL] ${label}: ${action}`);
}

function probe(command, args, check, label, action) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const value = result.status === 0 ? result.stdout.trim() : "";
  if (result.status === 0 && check(value)) pass(label);
  else fail(label, action);
}

function supportedComposeVersion(value) {
  const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\D|$)/u.exec(value);
  if (!match) return false;
  const current = match.slice(1).map(Number);
  const minimum = [2, 24, 0];
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

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

function readBindings(file) {
  const document = JSON.parse(readFileSync(file, "utf8"));
  const entries = Object.entries(document.bindings ?? {});
  if (entries.length === 0) throw new Error("no bindings");
  for (const [, binding] of entries) {
    if (!binding || typeof binding !== "object"
      || !binding.provider || !binding.baseUrl || !binding.apiKeyEnv || !binding.model) {
      throw new Error("invalid binding");
    }
  }
  return entries;
}

probe("node", ["--version"], (value) => /^v22\./u.test(value), "Node.js 22", "install Node.js 22");
probe("pnpm", ["--version"], (value) => value === "11.13.0", "pnpm 11.13.0", "install pnpm 11.13.0");
probe(
  "docker",
  ["compose", "version"],
  supportedComposeVersion,
  "Docker Compose 2.24.0+",
  "install Docker Compose 2.24.0 or newer",
);
probe("docker", ["info", "--format", "{{.ServerVersion}}"], Boolean, "Docker daemon", "start Docker Desktop");

try {
  const defaults = readEnvironment(".env.example");
  const bindings = readBindings("config/provider-bindings.fake.json");
  const fakeBinding = bindings.find(([name]) => name === "fake-default")?.[1];
  if (defaults.PROVIDER_BINDINGS_FILE !== "config/provider-bindings.fake.json"
    || defaults.FAKE_PROVIDER_API_KEY !== "fake-provider-local"
    || fakeBinding?.apiKeyEnv !== "FAKE_PROVIDER_API_KEY") {
    throw new Error("unsafe defaults");
  }
  pass("checked-in Fake Provider defaults");
} catch {
  fail("Fake Provider defaults", "restore .env.example and config/provider-bindings.fake.json");
}

if (realMode) {
  try {
    const overrides = readEnvironment(".env.local");
    const bindings = readBindings("config/provider-bindings.local.json");
    const missingCredential = bindings.some(([, binding]) =>
      binding.apiKeyEnv !== "REAL_PROVIDER_API_KEY" || !overrides.REAL_PROVIDER_API_KEY);
    if (missingCredential) throw new Error("missing credential");
    pass("ignored real-provider overrides");
  } catch {
    fail(
      "real-provider overrides",
      "copy config/provider-bindings.example.json to config/provider-bindings.local.json and set REAL_PROVIDER_API_KEY in .env.local",
    );
  }
}

if (failed) process.exitCode = 1;
else console.log(realMode ? "Real-provider startup is ready" : "Local startup is ready");
