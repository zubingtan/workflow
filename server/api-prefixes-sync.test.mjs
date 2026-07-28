import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Dev-mode API gate coupling invariant (map #133).
 *
 * server/index.mjs defines a hardcoded `API_PREFIXES` whitelist that gates
 * which paths go to Hono (vs rsbuild's SPA fallback) in dev mode. This list
 * MUST cover every API route registered in server/app.mjs — if a new route is
 * added to app.mjs but forgotten in API_PREFIXES, dev mode silently returns
 * index.html for that route (rsbuild's SPA fallback swallows it).
 *
 * This test pins the coupling by extracting both sides via regex and asserting
 * API_PREFIXES is a superset of app.mjs's route prefixes. No source code
 * changes needed — pure structural assertion.
 *
 * Note: this is a dev-mode-only concern. Prod mode (static-serving.test.mjs)
 * drives app.fetch() directly and bypasses apiGate entirely.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..");
const INDEX_PATH = resolve(REPO_ROOT, "server", "index.mjs");
const APP_PATH = resolve(REPO_ROOT, "server", "app.mjs");

function readSource(path) {
  if (!existsSync(path)) throw new Error(`missing: ${path}`);
  return readFileSync(path, "utf8");
}

/**
 * Extract the API_PREFIXES array from server/index.mjs.
 * Matches: const API_PREFIXES = ["/health", "/agents", ...];
 */
function extractApiPrefixes(content) {
  const m = content.match(/API_PREFIXES\s*=\s*\[([^\]]*)\]/);
  assert.ok(m, "server/index.mjs must define API_PREFIXES = [...]");
  const raw = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^['"]|['"]$/g, ""));
  return new Set(raw);
}

/**
 * Extract route path prefixes from server/app.mjs.
 * Matches: app.get/post/put/delete("/path/...", ...) — captures the leading
 * path segment (e.g. "/agents" from "/agents/:id").
 *
 * Static-serve routes (app.use("/static/*"), app.get("/"), app.get("*"),
 * app.get("/index.html"), app.get("/favicon.ico")) are NOT API routes — they
 * only exist inside the `if (staticEnabled)` block and are served by rsbuild
 * in dev mode. Excluded by the filter.
 */
function extractAppRoutePrefixes(content) {
  const prefixes = new Set();
  const routeRe = /app\.(?:get|post|put|delete|use)\(\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = routeRe.exec(content)) !== null) {
    const full = m[1];
    // Skip wildcards, static-asset mounts, and SPA fallback paths — not API routes.
    if (
      full === "*" ||
      full === "/" ||
      full === "/index.html" ||
      full === "/favicon.ico" ||
      full.startsWith("/static")
    ) {
      continue;
    }
    // Take the leading path segment as the prefix.
    // "/api/task/run" → "/api/task"; "/agents/:id" → "/agents"; "/health/live" → "/health".
    const segments = full.split("/").filter(Boolean);
    if (segments.length === 0) continue;
    // For /api/task/* keep two segments (the namespace + resource); for others keep one.
    const prefix = segments[0] === "api" && segments.length >= 2
      ? `/${segments[0]}/${segments[1]}`
      : `/${segments[0]}`;
    prefixes.add(prefix);
  }
  return prefixes;
}

test("API_PREFIXES in index.mjs covers every app.mjs route prefix", () => {
  const indexSrc = readSource(INDEX_PATH);
  const appSrc = readSource(APP_PATH);

  const apiPrefixes = extractApiPrefixes(indexSrc);
  const routePrefixes = extractAppRoutePrefixes(appSrc);

  // Every route prefix in app.mjs must be covered by an entry in API_PREFIXES.
  // (API_PREFIXES entries may be prefixes themselves, e.g. "/api/task" covers
  // "/api/task/run" via the startsWith check in apiGate.)
  const missing = [...routePrefixes].filter(
    (p) => !apiPrefixes.has(p) && !apiPrefixes.has(p.split("/").slice(0, 2).join("/"))
  );

  assert.deepEqual(
    missing,
    [],
    `API_PREFIXES in server/index.mjs is missing coverage for app.mjs routes: ${missing.join(", ")}. ` +
      `Without coverage, dev mode returns index.html (SPA fallback) instead of JSON for these routes. ` +
      `Either add the prefix to API_PREFIXES or remove the route from app.mjs.`
  );
});

test("API_PREFIXES is non-empty (sanity check)", () => {
  const indexSrc = readSource(INDEX_PATH);
  const apiPrefixes = extractApiPrefixes(indexSrc);
  assert.ok(apiPrefixes.size > 0, "API_PREFIXES must not be empty");
});
