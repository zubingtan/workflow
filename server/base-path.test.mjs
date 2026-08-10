import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { createApp } from './app.mjs';
import { ensureSchema } from './db-schema.mjs';
import { createRunsEventBus } from './runs-events.mjs';

/**
 * #297: base path support (sub-path mount, e.g. nginx /workflow → node).
 *
 * With `createApp({ basePath: '/workflow' })` every route is served under the
 * prefix and the root paths are unreachable:
 *   - API:      GET /workflow/health/live → 200; GET /health/live → 404
 *   - Static:   GET /workflow/static/<hashed-asset> → 200 with correct mime
 *   - SPA:      GET /workflow/<unknown deep path> → index.html; POST → 404
 *   - SSE:      GET /workflow/api/workflows/<id>/runs/events → event-stream
 *
 * Default `basePath` (unset) keeps today's root-path behavior: the plain
 * /health/live still answers 200 and the prefixed path is 404.
 */

function setupFixture() {
  const staticDir = mkdtempSync(join(tmpdir(), 'workflow-basepath-static-'));
  mkdirSync(join(staticDir, 'static', 'js'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>SPA</title>');
  writeFileSync(join(staticDir, 'static', 'js', 'index.a1b2c3d4.js'), 'console.log(1);');
  return staticDir;
}

function makeApp(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'workflow-basepath-db-'));
  const db = new Database(join(dir, 'workflow.db'));
  db.pragma('journal_mode = WAL');
  ensureSchema(db);
  // streamRunEvents 404s on unknown workflow ids — seed one for the SSE test.
  db.prepare("INSERT INTO workflows (id, name, data) VALUES ('wf_1', 'n', ?)").run(
    JSON.stringify({ nodes: [], edges: [] })
  );
  const app = createApp({
    db,
    agentDir: dir,
    staticEnabled: true,
    staticDir: setupFixture(),
    eventBus: createRunsEventBus(),
    ...options,
  });
  return { app, db };
}

const BASE = 'http://localhost';

test('basePath: API answers under prefix, root path is 404', async () => {
  const { app } = makeApp({ basePath: '/workflow' });
  const ok = await app.fetch(new Request(`${BASE}/workflow/health/live`));
  assert.equal(ok.status, 200);
  const root = await app.fetch(new Request(`${BASE}/health/live`));
  assert.equal(root.status, 404);
});

test('basePath: /static/* serves hashed assets under prefix', async () => {
  const { app } = makeApp({ basePath: '/workflow' });
  const res = await app.fetch(
    new Request(`${BASE}/workflow/static/js/index.a1b2c3d4.js`)
  );
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /javascript/);
});

test('basePath: unknown GET falls back to index.html, POST is 404', async () => {
  const { app } = makeApp({ basePath: '/workflow' });
  const get = await app.fetch(new Request(`${BASE}/workflow/some/deep/route`));
  assert.equal(get.status, 200);
  assert.match(await get.text(), /SPA/);
  const post = await app.fetch(
    new Request(`${BASE}/workflow/some/deep/route`, { method: 'POST' })
  );
  assert.equal(post.status, 404);
});

test('basePath: SSE endpoint streams under prefix', async () => {
  const { app } = makeApp({ basePath: '/workflow' });
  const res = await app.fetch(
    new Request(`${BASE}/workflow/api/workflows/wf_1/runs/events`)
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'text/event-stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('"type":"init"')) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  assert.ok(text.includes(':ping\n\n'), 'initial :ping flushed headers');
  await reader.cancel();
});

test('default basePath keeps root-path behavior (regression guard)', async () => {
  const { app } = makeApp();
  const ok = await app.fetch(new Request(`${BASE}/health/live`));
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') ?? '', /application\/json/);
});
