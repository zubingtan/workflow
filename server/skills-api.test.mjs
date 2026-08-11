import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { createApp } from './app.mjs';
import { ensureSchema } from './db-schema.mjs';
import { createAgent, updateAgent } from './agent-catalog.mjs';

function makeApp() {
  const db = new Database(':memory:');
  ensureSchema(db);
  const skillsDir = mkdtempSync(join(tmpdir(), 'skills-api-'));
  const app = createApp({ db, agentDir: '/tmp/skills-api-agent', skillsDir });
  return { db, app, skillsDir };
}

async function jsonRequest(app, path, method, body) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

const validTree = [
  { path: 'SKILL.md', content: '---\nname: zh-en\ndescription: Translate\n---\nBody' },
  { path: 'assets/note.txt', content: 'hello' },
];

test('skills CRUD round-trip through the API', async () => {
  const { app } = makeApp();

  // empty list initially
  assert.deepEqual(await (await jsonRequest(app, '/skills', 'GET')).json(), []);

  // create via PUT (upsert)
  const put = await jsonRequest(app, '/skills/zh-en', 'PUT', { files: validTree });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { name: 'zh-en' });

  // list shows it
  const list = await (await jsonRequest(app, '/skills', 'GET')).json();
  assert.deepEqual(list, [{ name: 'zh-en', description: 'Translate' }]);

  // read tree
  const tree = await (await jsonRequest(app, '/skills/zh-en', 'GET')).json();
  assert.equal(tree.name, 'zh-en');
  assert.equal(tree.files.length, 2);

  // save without SKILL.md → 400
  const noMd = await jsonRequest(app, '/skills/bad', 'PUT', { files: [{ path: 'a.txt', content: 'x' }] });
  assert.equal(noMd.status, 400);
  assert.equal((await noMd.json()).code, 'missing_skill_md');

  // invalid name → 400
  const badName = await jsonRequest(app, '/skills/Bad Name', 'PUT', { files: validTree });
  assert.equal(badName.status, 400);

  // missing skill → 404
  assert.equal((await jsonRequest(app, '/skills/nope', 'GET')).status, 404);
});

test('import creates and overrides a skill', async () => {
  const { app } = makeApp();
  await jsonRequest(app, '/skills/zh-en', 'PUT', { files: validTree });

  const imported = await jsonRequest(app, '/skills/import', 'POST', {
    name: 'zh-en',
    files: [{ path: 'SKILL.md', content: '---\ndescription: v2\n---\nNew' }],
  });
  assert.equal(imported.status, 200);

  const tree = await (await jsonRequest(app, '/skills/zh-en', 'GET')).json();
  assert.deepEqual(tree.files.map((f) => f.path), ['SKILL.md']); // override replaced the tree
  assert.ok(tree.files[0].content.includes('v2'));

  const missing = await jsonRequest(app, '/skills/import', 'POST', {
    name: 'x',
    files: [{ path: 'a.txt', content: 'x' }],
  });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).code, 'missing_skill_md');
});

test('rename renames dir and syncs frontmatter', async () => {
  const { app, skillsDir } = makeApp();
  await jsonRequest(app, '/skills/zh-en', 'PUT', { files: validTree });

  const rename = await jsonRequest(app, '/skills/zh-en/rename', 'POST', { new_name: 'zh-en-v2' });
  assert.equal(rename.status, 200);
  assert.ok(existsSync(join(skillsDir, 'zh-en-v2')));
  assert.ok(!existsSync(join(skillsDir, 'zh-en')));
  const skillMd = readFileSync(join(skillsDir, 'zh-en-v2', 'SKILL.md'), 'utf-8');
  assert.match(skillMd, /name: zh-en-v2/);

  // conflict → 409
  await jsonRequest(app, '/skills/other', 'PUT', { files: validTree });
  const conflict = await jsonRequest(app, '/skills/zh-en-v2/rename', 'POST', { new_name: 'other' });
  assert.equal(conflict.status, 409);
});

test('delete is blocked while agents reference the skill', async () => {
  const { app, db, skillsDir } = makeApp();
  await jsonRequest(app, '/skills/zh-en', 'PUT', { files: validTree });
  const agent = createAgent(db, {
    name: 'Ref Agent',
    config: { provider: {}, pi_settings: { skills: ['zh-en'] } },
  });

  const refs = await (await jsonRequest(app, '/skills/zh-en/references', 'GET')).json();
  assert.deepEqual(refs, { referencedBy: ['Ref Agent'] });

  const blocked = await jsonRequest(app, '/skills/zh-en', 'DELETE');
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'referenced');
  assert.ok(existsSync(join(skillsDir, 'zh-en')));

  // after the reference is removed the delete succeeds
  updateAgent(db, agent.id, { config: { pi_settings: { skills: [] } } });
  const ok = await jsonRequest(app, '/skills/zh-en', 'DELETE');
  assert.equal(ok.status, 200);
  assert.ok(!existsSync(join(skillsDir, 'zh-en')));
});

test('rename is blocked while agents reference the old name', async () => {
  const { app, db } = makeApp();
  await jsonRequest(app, '/skills/zh-en', 'PUT', { files: validTree });
  createAgent(db, {
    name: 'Ref Agent',
    config: { provider: {}, pi_settings: { skills: ['zh-en'] } },
  });

  const blocked = await jsonRequest(app, '/skills/zh-en/rename', 'POST', { new_name: 'zh-en-v2' });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, 'referenced');

  // no-op rename (same name) is allowed even when referenced — nothing changes
  const noop = await jsonRequest(app, '/skills/zh-en/rename', 'POST', { new_name: 'zh-en' });
  assert.equal(noop.status, 200);

  // once the reference is gone the rename succeeds
  const agent = db.prepare("SELECT id FROM agents WHERE name = 'Ref Agent'").get();
  updateAgent(db, agent.id, { config: { pi_settings: { skills: [] } } });
  const ok = await jsonRequest(app, '/skills/zh-en/rename', 'POST', { new_name: 'zh-en-v2' });
  assert.equal(ok.status, 200);
});

test('traversal-style names are rejected on read and delete (no fs escape)', async () => {
  const { app } = makeApp();
  await jsonRequest(app, '/skills/zh-en', 'PUT', { files: validTree });

  // %2F decodes to '/' — Hono passes it to the handler as part of :name
  const read = await jsonRequest(app, '/skills/..%2F..%2Fetc', 'GET');
  assert.equal(read.status, 400);
  assert.equal((await read.json()).code, 'invalid_name');

  const del = await jsonRequest(app, '/skills/..%2F..%2Fetc', 'DELETE');
  assert.equal(del.status, 400);
  assert.equal((await del.json()).code, 'invalid_name');
});

test('agent import precheck reports missing skills', async () => {
  const { app } = makeApp();
  await jsonRequest(app, '/skills/known', 'PUT', { files: validTree });

  const precheck = await jsonRequest(app, '/agents/import', 'POST', [
    {
      name: 'A',
      runtime: 'pi-coding-agent',
      config: { pi_settings: { skills: ['known', 'missing-one', 'missing-two'] } },
    },
    { name: 'B', config: { pi_settings: { skills: ['missing-one'] } } },
  ]);
  assert.equal(precheck.status, 200);
  const body = await precheck.json();
  assert.deepEqual(body.missing_skills, ['missing-one', 'missing-two']);
});
