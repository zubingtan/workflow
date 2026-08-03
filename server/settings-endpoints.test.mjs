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
 * T3 (#215): mem0_host + mem0_api_key settings.
 *
 * - GET /api/settings returns {node_timeout_default_ms, mem0_host, mem0_api_key}
 *   with only known keys present (absent = null).
 * - PUT /api/settings accepts any subset of known keys (partial update).
 * - node_timeout_default_ms: Number.isInteger && > 0 && <= 24h (86400000ms).
 * - mem0_host: valid http(s) URL.
 * - mem0_api_key: non-empty string.
 * - Unknown keys in PUT body → 400.
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

test("GET /api/settings returns null for all keys when no settings row exists", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await getSettings(app);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, {
    node_timeout_default_ms: null,
    mem0_host: null,
    mem0_api_key: null,
    mem0_admin_key: null,
    mem0_llm_base_url: null,
    mem0_llm_model: null,
    mem0_embedder_model: null,
    mem0_embedding_dims: null,
  });
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
  for (const bad of [300000.5, "300000", true, {}]) {
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

test("PUT /api/settings accepts node_timeout_default_ms: null (clears the row)", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  // Set first, then clear with null.
  await putSettings(app, { node_timeout_default_ms: 300000 });
  const res = await putSettings(app, { node_timeout_default_ms: null });
  assert.equal(res.status, 200);
  const body = await (await getSettings(app)).json();
  assert.equal(body.node_timeout_default_ms, null);
});

test("PUT /api/settings rejects unknown key with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, { unrelated_key: 123 });
  assert.equal(res.status, 400);
});

test("PUT /api/settings rejects empty body with 400", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, {});
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

// --- T3 (#215): mem0_host + mem0_api_key ---

test("PUT /api/settings persists mem0_host and mem0_api_key", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  const res = await putSettings(app, {
    mem0_host: "http://localhost:8890",
    mem0_api_key: "secret-key-123",
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mem0_host, "http://localhost:8890");
  assert.equal(body.mem0_api_key, "secret-key-123");

  const getBody = await (await getSettings(app)).json();
  assert.equal(getBody.mem0_host, "http://localhost:8890");
  assert.equal(getBody.mem0_api_key, "secret-key-123");
});

test("PUT /api/settings allows partial update (mem0 only, no timeout)", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  await putSettings(app, { node_timeout_default_ms: 300000 });
  const res = await putSettings(app, { mem0_host: "https://mem0.example.com" });
  assert.equal(res.status, 200);
  const getBody = await (await getSettings(app)).json();
  assert.equal(getBody.node_timeout_default_ms, 300000);
  assert.equal(getBody.mem0_host, "https://mem0.example.com");
});

test("PUT /api/settings rejects invalid mem0_host (not a URL)", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  for (const bad of ["not-a-url", "ftp://foo.com", "", 123]) {
    const res = await putSettings(app, { mem0_host: bad });
    assert.equal(res.status, 400, `should reject mem0_host=${JSON.stringify(bad)}`);
    const body = await res.json();
    assert.match(body.error || "", /mem0_host/i);
  }
});

test("PUT /api/settings accepts valid mem0_host URLs", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  for (const good of ["http://localhost:8890", "https://mem0.example.com", "http://192.168.1.1:9000"]) {
    const res = await putSettings(app, { mem0_host: good });
    assert.equal(res.status, 200, `should accept mem0_host=${good}`);
  }
});

test("PUT /api/settings rejects invalid mem0_api_key (empty or non-string)", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  for (const bad of ["", "   ", 123, {}]) {
    const res = await putSettings(app, { mem0_api_key: bad });
    assert.equal(res.status, 400, `should reject mem0_api_key=${JSON.stringify(bad)}`);
    const body = await res.json();
    assert.match(body.error || "", /mem0_api_key/i);
  }
});

test("PUT /api/settings with null clears mem0 settings", async () => {
  const { db, dir } = setupDb();
  const app = createApp({ db, agentDir: dir });
  // Set values first.
  await putSettings(app, { mem0_host: "http://localhost:8890", mem0_api_key: "key123" });
  let getBody = await (await getSettings(app)).json();
  assert.equal(getBody.mem0_host, "http://localhost:8890");
  assert.equal(getBody.mem0_api_key, "key123");

  // Clear with null.
  const res = await putSettings(app, { mem0_host: null, mem0_api_key: null });
  assert.equal(res.status, 200);
  getBody = await (await getSettings(app)).json();
  assert.equal(getBody.mem0_host, null);
  assert.equal(getBody.mem0_api_key, null);
});
