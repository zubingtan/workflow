import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { ensureSchema } from '../server/db-schema.mjs';
import { createAgent } from '../server/agent-catalog.mjs';
import {
  SkillError,
  validateSkillName,
  parseSkillFrontmatter,
  syncFrontmatterName,
  listSkills,
  readSkillTree,
  writeSkillTree,
  renameSkill,
  deleteSkillDir,
  skillReferences,
  resolveSkillPaths,
} from '../server/skills.mjs';

function makeSkillsDir() {
  return mkdtempSync(join(tmpdir(), 'skills-test-'));
}

const validTree = [
  { path: 'SKILL.md', content: '---\nname: test-skill\ndescription: A test skill\n---\nBody' },
  { path: 'scripts/run.sh', content: '#!/bin/sh\necho hi' },
];

test('validateSkillName enforces pi-agent name rules', () => {
  assert.equal(validateSkillName('zh-en-translator'), null);
  assert.equal(validateSkillName('a'.repeat(64)), null);
  assert.ok(validateSkillName('a'.repeat(65)));
  assert.ok(validateSkillName('Uppercase'));
  assert.ok(validateSkillName('under_score'));
  assert.ok(validateSkillName('-leading'));
  assert.ok(validateSkillName('trailing-'));
  assert.ok(validateSkillName('double--hyphen'));
  assert.ok(validateSkillName(''));
  assert.ok(validateSkillName(undefined));
});

test('parseSkillFrontmatter reads name and description', () => {
  const fm = parseSkillFrontmatter('---\nname: my-skill\ndescription: Does things\n---\nBody');
  assert.equal(fm.name, 'my-skill');
  assert.equal(fm.description, 'Does things');
  assert.equal(fm.hasFrontmatter, true);
  assert.equal(fm.body, 'Body');

  const none = parseSkillFrontmatter('no frontmatter here');
  assert.equal(none.hasFrontmatter, false);
  assert.equal(none.name, undefined);
  assert.equal(none.body, 'no frontmatter here');

  const quoted = parseSkillFrontmatter('---\ndescription: "Quoted desc"\n---\nBody');
  assert.equal(quoted.description, 'Quoted desc');

  // frontmatter followed by a blank line — the blank line is not part of body
  const blank = parseSkillFrontmatter('---\nname: x\n---\n\nBody');
  assert.equal(blank.body, 'Body');
});

test('syncFrontmatterName rewrites an existing name field only', () => {
  const withName = '---\nname: old-name\ndescription: d\n---\nBody';
  assert.match(syncFrontmatterName(withName, 'new-name'), /^---\nname: new-name\ndescription: d\n---\nBody$/);

  const withoutName = '---\ndescription: d\n---\nBody';
  assert.equal(syncFrontmatterName(withoutName, 'new-name'), withoutName);

  const noFrontmatter = 'plain body';
  assert.equal(syncFrontmatterName(noFrontmatter, 'new-name'), noFrontmatter);
});

test('writeSkillTree creates a skill and readSkillTree round-trips it', () => {
  const dir = makeSkillsDir();
  writeSkillTree(dir, 'test-skill', validTree);
  assert.ok(existsSync(join(dir, 'test-skill', 'SKILL.md')));

  const tree = readSkillTree(dir, 'test-skill');
  assert.equal(tree.name, 'test-skill');
  assert.equal(tree.files.length, 2);
  const skillMd = tree.files.find((f) => f.path === 'SKILL.md');
  assert.ok(skillMd.content.includes('name: test-skill'));
  const script = tree.files.find((f) => f.path === 'scripts/run.sh');
  assert.equal(script.content, '#!/bin/sh\necho hi');
});

test('writeSkillTree requires SKILL.md and valid names', () => {
  const dir = makeSkillsDir();
  assert.throws(() => writeSkillTree(dir, 'no-skill-md', [{ path: 'a.txt', content: 'x' }]), (e) => {
    assert.ok(e instanceof SkillError);
    assert.equal(e.code, 'missing_skill_md');
    return true;
  });
  assert.throws(() => writeSkillTree(dir, 'Bad Name', validTree), (e) => e.code === 'invalid_name');
});

test('writeSkillTree rejects path traversal', () => {
  const dir = makeSkillsDir();
  assert.throws(
    () => writeSkillTree(dir, 'evil', [{ path: 'SKILL.md', content: 'x' }, { path: '../escape', content: 'y' }]),
    (e) => e.code === 'invalid_path'
  );
  assert.ok(!existsSync(join(dir, 'escape')));
});

test('writeSkillTree overwrite replaces the whole tree', () => {
  const dir = makeSkillsDir();
  writeSkillTree(dir, 'skill-a', validTree);
  writeSkillTree(dir, 'skill-a', [
    { path: 'SKILL.md', content: '---\ndescription: new\n---\nNew body' },
    { path: 'extra.txt', content: 'kept' },
  ]);
  const tree = readSkillTree(dir, 'skill-a');
  assert.deepEqual(tree.files.map((f) => f.path).sort(), ['SKILL.md', 'extra.txt']);
  assert.ok(!tree.files.some((f) => f.path === 'scripts/run.sh'));
});

test('writeSkillTree size guard applies to decoded byte length', () => {
  const dir = makeSkillsDir();
  const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);

  // text payload over the limit
  assert.throws(
    () => writeSkillTree(dir, 'big-text', [{ path: 'SKILL.md', content: big.toString('utf-8') }]),
    (e) => e.code === 'file_too_large' && e.status === 413
  );

  // base64 payload whose DECODED size exceeds the limit (encoded string is
  // even longer, so the old check would also reject it — verify the new one)
  assert.throws(
    () =>
      writeSkillTree(dir, 'big-b64', [
        { path: 'SKILL.md', content: big.toString('base64'), encoding: 'base64' },
      ]),
    (e) => e.code === 'file_too_large' && e.status === 413
  );

  // base64 with a long encoded string but small decoded payload passes
  const small = Buffer.from('hi');
  const padded = small.toString('base64') + '='.repeat(100); // valid-ish padding noise
  assert.doesNotThrow(() =>
    writeSkillTree(dir, 'pad-b64', [{ path: 'SKILL.md', content: padded, encoding: 'base64' }])
  );
});

test('binary files round-trip as base64', () => {
  const dir = makeSkillsDir();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
  const tree = [...validTree, { path: 'assets/logo.png', content: png.toString('base64'), encoding: 'base64' }];
  writeSkillTree(dir, 'with-bin', tree);
  const read = readSkillTree(dir, 'with-bin');
  const logo = read.files.find((f) => f.path === 'assets/logo.png');
  assert.equal(logo.encoding, 'base64');
  assert.equal(Buffer.from(logo.content, 'base64').toString('hex'), png.toString('hex'));
});

test('listSkills returns name + description, ordered', () => {
  const dir = makeSkillsDir();
  writeSkillTree(dir, 'b-skill', [
    { path: 'SKILL.md', content: '---\ndescription: Bee\n---\nB' },
  ]);
  writeSkillTree(dir, 'a-skill', [
    { path: 'SKILL.md', content: '---\ndescription: Ay\n---\nA' },
  ]);
  mkdirSync(join(dir, 'not-a-skill'), { recursive: true }); // no SKILL.md
  assert.deepEqual(listSkills(dir), [
    { name: 'a-skill', description: 'Ay' },
    { name: 'b-skill', description: 'Bee' },
  ]);
});

test('renameSkill renames dir and syncs frontmatter name', () => {
  const dir = makeSkillsDir();
  writeSkillTree(dir, 'old-name', validTree);
  const result = renameSkill(dir, 'old-name', 'new-name');
  assert.equal(result.name, 'new-name');
  assert.ok(!existsSync(join(dir, 'old-name')));
  const skillMd = readFileSync(join(dir, 'new-name', 'SKILL.md'), 'utf-8');
  assert.match(skillMd, /^---\nname: new-name\n/);

  assert.deepEqual(renameSkill(dir, 'new-name', 'new-name'), { name: 'new-name' }); // no-op ok
  writeSkillTree(dir, 'other', [{ path: 'SKILL.md', content: 'x' }]);
  assert.throws(() => renameSkill(dir, 'new-name', 'other'), (e) => e.code === 'already_exists');
  assert.throws(() => renameSkill(dir, 'missing', 'target'), (e) => e.code === 'not_found');
  assert.throws(() => renameSkill(dir, 'new-name', 'Bad Name'), (e) => e.code === 'invalid_name');
  // the old name is validated too — path traversal is rejected before any IO
  assert.throws(() => renameSkill(dir, '..%2F', 'target'), (e) => e.code === 'invalid_name');
});

test('deleteSkillDir removes the directory', () => {
  const dir = makeSkillsDir();
  writeSkillTree(dir, 'gone', validTree);
  deleteSkillDir(dir, 'gone');
  assert.ok(!existsSync(join(dir, 'gone')));
  assert.throws(() => deleteSkillDir(dir, 'gone'), (e) => e.code === 'not_found');
});

test('read/delete/rename reject traversal-style names before touching the fs', () => {
  const dir = makeSkillsDir();
  writeSkillTree(dir, 'safe', validTree);

  for (const bad of ['..', '../etc', '..%2F', 'a/b', 'a\\b', '/etc', '.']) {
    assert.throws(() => readSkillTree(dir, bad), (e) => e.code === 'invalid_name', `read ${bad}`);
    assert.throws(() => deleteSkillDir(dir, bad), (e) => e.code === 'invalid_name', `delete ${bad}`);
  }
  // nothing was created or removed outside the library
  assert.ok(!existsSync(join(dir, '..', 'etc')));
  assert.ok(existsSync(join(dir, 'safe')));
});

test('skillReferences finds agents referencing a skill by name', () => {
  const db = new Database(':memory:');
  ensureSchema(db);
  const mkAgent = (name, skills) =>
    createAgent(db, {
      name,
      config: { provider: {}, pi_settings: { skills } },
    });
  mkAgent('with-skill', ['zh-en-translator']);
  mkAgent('without', []);
  mkAgent('other-skill', ['grilling']);

  const refs = skillReferences(db, 'zh-en-translator');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].name, 'with-skill');
  assert.deepEqual(skillReferences(db, 'grilling').map((r) => r.name), ['other-skill']);
  assert.deepEqual(skillReferences(db, 'missing'), []);
});

test('resolveSkillPaths maps names to library paths, passes through existing paths, skips unknown', () => {
  const dir = makeSkillsDir();
  writeSkillTree(dir, 'known', validTree);
  const existingPath = join(dir, 'known');

  const ok = resolveSkillPaths(dir, ['known']);
  assert.deepEqual(ok.paths, [existingPath]);
  assert.deepEqual(ok.skipped, []);

  const mixed = resolveSkillPaths(dir, ['known', existingPath, 'unknown-skill']);
  assert.deepEqual(mixed.paths, [existingPath, existingPath]);
  assert.deepEqual(mixed.skipped, ['unknown-skill']);

  assert.deepEqual(resolveSkillPaths(dir, undefined), { paths: [], skipped: [] });
});
