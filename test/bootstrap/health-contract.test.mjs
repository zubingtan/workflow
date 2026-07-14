import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function route(kind) {
  const candidates = [
    `src/app/api/health/${kind}/route.ts`,
    `app/api/health/${kind}/route.ts`,
  ];
  const relativePath = candidates.find((candidate) => existsSync(path.join(root, candidate)));
  assert.ok(relativePath, `missing ${kind} health route (${candidates.join(" or ")})`);
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("M0-T01 app exposes distinct liveness and database readiness GET routes", () => {
  const live = route("live");
  const ready = route("ready");
  assert.match(live, /export\s+(?:async\s+)?function\s+GET\b/);
  assert.match(ready, /export\s+(?:async\s+)?function\s+GET\b/);
  assert.match(ready, /database|postgres|sql|query/i, "readiness must check PostgreSQL");
});
