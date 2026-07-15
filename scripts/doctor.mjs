import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

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
  if (result.status === 0 && check(value)) {
    pass(label);
  } else {
    fail(label, action);
  }
}

function supportedComposeVersion(value) {
  const match = /(?:^|\s)v?(\d+)\.(\d+)\.(\d+)(?:\D|$)/u.exec(value);
  if (!match) return false;
  const version = match.slice(1).map(Number);
  const minimum = [2, 24, 0];
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

probe("node", ["--version"], (value) => /^v22\./.test(value), "Node.js 22", "install Node.js 22");
probe("pnpm", ["--version"], (value) => value === "11.13.0", "pnpm 11.13.0", "install pnpm 11.13.0");
probe(
  "docker",
  ["compose", "version"],
  supportedComposeVersion,
  "Docker Compose 2.24.0+",
  "install Docker Compose 2.24.0 or newer",
);

if (process.env.DATABASE_URL) {
  pass("DATABASE_URL configured");
} else {
  fail("database", "set DATABASE_URL");
}

const bindingFile = process.env.PROVIDER_BINDINGS_FILE;
if (!bindingFile) {
  fail("provider binding", "set PROVIDER_BINDINGS_FILE");
} else {
  try {
    const document = JSON.parse(readFileSync(bindingFile, "utf8"));
    const bindings = Object.values(document.bindings ?? {});
    if (bindings.length === 0) {
      fail("provider binding", "configure at least one binding");
    } else {
      let bindingValid = true;
      for (const binding of bindings) {
        if (!binding.provider || !binding.baseUrl || !binding.apiKeyEnv || !binding.model) {
          bindingValid = false;
          fail("provider binding", "configure provider, baseUrl, apiKeyEnv, and model");
          continue;
        }
        if (!process.env[binding.apiKeyEnv]) {
          bindingValid = false;
          fail("provider credential", `set ${binding.apiKeyEnv}`);
        }
      }
      if (bindingValid) {
        pass("provider bindings configured");
      }
    }
  } catch {
    fail("provider binding", "provide a readable JSON file");
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Bootstrap is ready");
}
