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
  assert.deepEqual(body, { node_timeout_default_ms: null });
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
