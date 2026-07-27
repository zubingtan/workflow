import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { createApp } from "./app.mjs";

/**
 * T4 (#120): prod-mode static serving + SPA fallback.
 *
 * These tests drive the Hono app via `app.fetch(new Request(...))` — no real
 * HTTP server. The app factory accepts a `staticDir` pointing at a fixture
 * dist/ so we don't depend on `pnpm build:prod`.
 *
 * Behaviors pinned by T2 (#118) decision:
 *   1. API routes (registered first) win over static catch-all.
 *   2. `/static/*` serves real files with correct mime.
 *   3. Unknown GET paths fall back to index.html (SPA).
 *   4. POST to unknown path returns 404 (NOT swallowed by SPA fallback).
 */

function setupFixture() {
  const staticDir = mkdtempSync(join(tmpdir(), "workflow-static-"));
  mkdirSync(join(staticDir, "static", "js"), { recursive: true });
  mkdirSync(join(staticDir, "static", "css"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>SPA</title>");
  writeFileSync(join(staticDir, "favicon.ico"), "fake-ico-bytes");
  writeFileSync(join(staticDir, "static", "js", "index.a1b2c3d4.js"), "console.log(1);");
  writeFileSync(join(staticDir, "static", "css", "main.e5f6g7h8.css"), "body{}");
  return staticDir;
}

function setupDb() {
  const dataDir = mkdtempSync(join(tmpdir(), "workflow-db-"));
  const dbPath = join(dataDir, "workflow.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      provider_base_url TEXT NOT NULL, provider_api_key TEXT NOT NULL,
      model TEXT NOT NULL, system_prompt TEXT DEFAULT '',
      temperature REAL DEFAULT 0.7,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  return { db, dataDir };
}

function makeApp() {
  const staticDir = setupFixture();
  const { db, dataDir } = setupDb();
  return {
    app: createApp({
      db,
      agentDir: dataDir,
      staticEnabled: true,
      staticDir,
    }),
    staticDir,
    dataDir,
    db,
  };
}

test("prod: API route /health/live returns JSON (priority over static)", async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request("http://localhost/health/live"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = await res.json();
  assert.equal(body.status, "live");
});

test("prod: /static/js/*.js served with application/javascript mime", async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request("http://localhost/static/js/index.a1b2c3d4.js"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /javascript/);
  const text = await res.text();
  assert.equal(text, "console.log(1);");
});

test("prod: /static/css/*.css served with text/css mime", async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request("http://localhost/static/css/main.e5f6g7h8.css"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/css/);
});

test("prod: / returns index.html", async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request("http://localhost/"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const text = await res.text();
  assert.match(text, /<title>SPA<\/title>/);
});

test("prod: /index.html returns index.html", async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request("http://localhost/index.html"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
});

test("prod: /favicon.ico served", async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request("http://localhost/favicon.ico"));
  assert.equal(res.status, 200);
});

test("prod: unknown GET path falls back to index.html (SPA fallback)", async () => {
  const { app } = makeApp();
  const res = await app.fetch(new Request("http://localhost/some-deep-spa-route"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const text = await res.text();
  assert.match(text, /<title>SPA<\/title>/);
});

test("prod: POST to unknown path returns 404 (NOT swallowed by SPA fallback)", async () => {
  const { app } = makeApp();
  const res = await app.fetch(
    new Request("http://localhost/unknown-api", { method: "POST", body: "{}" })
  );
  assert.equal(res.status, 404);
});

test("prod: DELETE to unknown path returns 404", async () => {
  const { app } = makeApp();
  const res = await app.fetch(
    new Request("http://localhost/unknown", { method: "DELETE" })
  );
  assert.equal(res.status, 404);
});

test("prod: hash-named js has immutable cache, index.html has no-cache", async () => {
  const { app } = makeApp();
  const jsRes = await app.fetch(new Request("http://localhost/static/js/index.a1b2c3d4.js"));
  // Hash-named assets: long-lived immutable cache.
  const jsCache = jsRes.headers.get("cache-control") ?? "";
  assert.ok(
    /immutable|max-age=\d{4,}/.test(jsCache),
    `expected long cache for hash asset, got: ${jsCache}`
  );

  const htmlRes = await app.fetch(new Request("http://localhost/"));
  const htmlCache = htmlRes.headers.get("cache-control") ?? "";
  assert.ok(
    /no-cache|no-store|must-revalidate/.test(htmlCache),
    `expected no-cache for index.html, got: ${htmlCache}`
  );
});

test("dev: staticEnabled=false → no static routes, unknown GET returns 404 (no SPA fallback)", async () => {
  const { db, dataDir } = setupDb();
  const app = createApp({
    db,
    agentDir: dataDir,
    staticEnabled: false,
    staticDir: "/nonexistent",
  });
  const res = await app.fetch(new Request("http://localhost/unknown-path"));
  assert.equal(res.status, 404);
});
