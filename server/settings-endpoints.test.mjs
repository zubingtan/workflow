import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

import { createApp } from "./app.mjs";
import { ensureSchema } from "./db-schema.mjs";

/**
 * Phase 9 (#161): GET/PUT /api/settings endpoints.
 *
 * - GET /api/settings returns {node_timeout_default_ms: <number|null>, ...}
 *   with only known keys present.
 * - PUT /api/settings validates Number.isInteger && > 0 && <= 24h (86400000ms)
 *   and upserts into the settings table.
 * - Invalid body (non-integer, <=0, >24h, wrong type) → 400.
 * - Unknown keys in PUT body → 400 (only node_timeout_default_ms is accepted
 *   for now; future settings can be added).
 */

function setupDb() {
  const dir = mkdtempSync(join(tmpdir(), "wf-settings-"));
  const db = new Database(join(dir, "workflow.db"));
  db.pragma("journal_mode = WAL");
  ensureSchema(db);
  return { db, dir };
}

async function putSettings(app, body) {
  return app.fetch(
    new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

async function getSettings(app) {
  return app.fetch(new Request("http://localhost/api/settings"));
}

test("GET /api/settings returns empty object when no settings row exists", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await getSettings(app);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { node_timeout_default_ms: null, mem0_host: null, mem0_api_key: null });
});

test("PUT /api/settings persists node_timeout_default_ms and GET returns it", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });

  const putRes = await putSettings(app, { node_timeout_default_ms: 300000 });
  assert.equal(putRes.status, 200);
  const putBody = await putRes.json();
  assert.equal(putBody.node_timeout_default_ms, 300000);

  const getRes = await getSettings(app);
  const getBody = await getRes.json();
  assert.equal(getBody.node_timeout_default_ms, 300000);
});

test("PUT /api/settings is idempotent (upsert replaces previous value)", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  await putSettings(app, { node_timeout_default_ms: 300000 });
  const res = await putSettings(app, { node_timeout_default_ms: 600000 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).node_timeout_default_ms, 600000);

  const getBody = await (await getSettings(app)).json();
  assert.equal(getBody.node_timeout_default_ms, 600000);
  // Only one row in settings table (upsert, not insert).
  const rows = db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key='node_timeout_default_ms'").get();
  assert.equal(rows.n, 1);
});

test("PUT /api/settings rejects non-integer with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  for (const bad of [300000.5, "300000", true, {}, null]) {
    const res = await putSettings(app, { node_timeout_default_ms: bad });
    assert.equal(res.status, 400, `should reject ${JSON.stringify(bad)}`);
    const body = await res.json();
    assert.match(body.error || "", /node_timeout_default_ms/i);
  }
});

test("PUT /api/settings rejects <=0 with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  for (const bad of [0, -1, -1000]) {
    const res = await putSettings(app, { node_timeout_default_ms: bad });
    assert.equal(res.status, 400, `should reject ${bad}`);
  }
});

test("PUT /api/settings rejects > 24h (86400000ms) with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, { node_timeout_default_ms: 86400001 });
  assert.equal(res.status, 400);
});

test("PUT /api/settings accepts exactly 24h (86400000ms)", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, { node_timeout_default_ms: 86400000 });
  assert.equal(res.status, 200);
});

test("PUT /api/settings rejects body without node_timeout_default_ms with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, { unrelated_key: 123 });
  assert.equal(res.status, 400);
});

test("PUT /api/settings rejects invalid JSON body with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await app.fetch(
    new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })
  );
  assert.equal(res.status, 400);
});

// --- mem0 settings (#212 D12): mem0_host + mem0_api_key ---

test("GET /api/settings returns mem0 keys as null when unset", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await getSettings(app);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    node_timeout_default_ms: null,
    mem0_host: null,
    mem0_api_key: null,
  });
});

test("PUT /api/settings accepts mem0_host + mem0_api_key without node_timeout_default_ms", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, {
    mem0_host: "http://localhost:8890",
    mem0_api_key: "admin-secret",
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    node_timeout_default_ms: null,
    mem0_host: "http://localhost:8890",
    mem0_api_key: "admin-secret",
  });
});

test("PUT /api/settings persists mem0 keys across requests (upsert)", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });

  await putSettings(app, { mem0_host: "http://mem0:8000", mem0_api_key: "k1" });
  await putSettings(app, { mem0_host: "http://mem0:8000", mem0_api_key: "k2" });

  const body = await (await getSettings(app)).json();
  assert.equal(body.mem0_api_key, "k2");
});

test("PUT /api/settings allows clearing mem0_host with an empty string", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  await putSettings(app, { mem0_host: "http://localhost:8890" });
  const res = await putSettings(app, { mem0_host: "" });
  assert.equal(res.status, 200);
  const body = await (await getSettings(app)).json();
  assert.equal(body.mem0_host, "");
});

test("PUT /api/settings rejects a non-URL mem0_host with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, { mem0_host: "not a url" });
  assert.equal(res.status, 400);
});

test("PUT /api/settings rejects a non-http(s) mem0_host with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, { mem0_host: "ftp://mem0:8000" });
  assert.equal(res.status, 400);
});

test("PUT /api/settings rejects non-string mem0_api_key with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, { mem0_api_key: 123 });
  assert.equal(res.status, 400);
});

test("PUT /api/settings rejects an empty body with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, {});
  assert.equal(res.status, 400);
});

// --- CORS hardening (#212 security review) ---

test("CORS allows loopback origins only (not arbitrary web pages)", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });

  // Malicious webpage origin → NO CORS headers (browser blocks the response).
  const evilRes = await app.fetch(
    new Request("http://localhost/api/settings", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example.com",
      },
      body: JSON.stringify({ mem0_host: "http://attacker:9999" }),
    })
  );
  assert.equal(evilRes.headers.get("access-control-allow-origin"), null);
  // The request itself still lands (no auth on a local tool), but the browser
  // cannot read the response — the CSRF-style write is not exposed to JS.

  // Loopback origin → CORS headers present.
  const okRes = await app.fetch(
    new Request("http://localhost/api/settings", {
      headers: { Origin: "http://localhost:4001" },
    })
  );
  assert.equal(okRes.headers.get("access-control-allow-origin"), "http://localhost:4001");
});
