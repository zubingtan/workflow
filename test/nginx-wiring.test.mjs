import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildConfDContent,
  extractServerBlocks,
  findServerNameConflicts,
} from '../deploy/scripts/nginx-wiring.mjs';

// Full standalone nginx config (the w8 legacy layout: top-level events/http).
const FULL_CONFIG = `events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        '' close;
    }

    server {
        listen 8888;
        location / { proxy_pass http://127.0.0.1:3000; }
    }

    server {
        listen 80;
        server_name app.example.com;
        location /api/ { proxy_pass http://127.0.0.1:5013/; }
    }
}
`;

// conf.d-fragment input (http-context only, e.g. a fresh install layout).
const FRAGMENT_CONFIG = `server {
    listen 80;
    server_name app.example.com;
    location /api/ { proxy_pass http://127.0.0.1:5013/; }
}
`;

const INCLUDE_PATH = '/srv/workflow/deploy/nginx/workflow-location.conf';

test('extractServerBlocks drops top-level events/http and legacy 8888 server', () => {
  const { maps, servers } = extractServerBlocks(FULL_CONFIG);
  assert.equal(maps.length, 1);
  assert.ok(maps[0].includes('connection_upgrade'));
  assert.equal(servers.length, 1);
  assert.ok(servers[0].includes('app.example.com'));
  assert.ok(!servers[0].includes('8888'));
  assert.ok(!servers[0].includes('events'));
});

test('buildConfDContent keeps map blocks (http-context legal) alongside servers', () => {
  const out = buildConfDContent(FULL_CONFIG, INCLUDE_PATH);
  assert.ok(out.includes('map $http_upgrade $connection_upgrade'));
  assert.ok(out.includes('server_name app.example.com'));
  assert.ok(!out.includes('listen 8888'));
  assert.ok(!out.includes('events {'));
  assert.ok(!out.includes('default_type'));
});

test('buildConfDContent inserts include into the matching server block (brace-depth aware)', () => {
  const out = buildConfDContent(FULL_CONFIG, INCLUDE_PATH);
  // include must land after the server_name line and before the LAST closing
  // brace of that server block (inner location blocks have their own braces).
  const serverStart = out.indexOf('server_name app.example.com');
  const includeAt = out.indexOf(`include ${INCLUDE_PATH};`);
  const serverEnd = out.lastIndexOf('}');
  assert.ok(includeAt > serverStart && includeAt < serverEnd, 'include inside server block');
});

test('buildConfDContent is idempotent (no duplicate include)', () => {
  const once = buildConfDContent(FULL_CONFIG, INCLUDE_PATH);
  const twice = buildConfDContent(once, INCLUDE_PATH);
  assert.equal(twice.split(`include ${INCLUDE_PATH};`).length - 1, 1);
});

test('buildConfDContent handles conf.d-fragment input (no http wrapper)', () => {
  const out = buildConfDContent(FRAGMENT_CONFIG, INCLUDE_PATH);
  assert.ok(out.includes('server_name app.example.com'));
  assert.ok(out.includes(`include ${INCLUDE_PATH};`));
  assert.equal(out.split(`include ${INCLUDE_PATH};`).length - 1, 1);
});

test('findServerNameConflicts reports duplicate server_name on same listen', () => {
  const existing = `server {
    listen 80;
    server_name app.example.com;
    location /old/ { proxy_pass http://127.0.0.1:9999; }
}
`;
  const incoming = buildConfDContent(FULL_CONFIG, INCLUDE_PATH);
  const conflicts = findServerNameConflicts(existing, incoming);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].serverName, 'app.example.com');
  assert.equal(conflicts[0].listen, '80');
});

test('findServerNameConflicts ignores different server_names', () => {
  const existing = `server {
    listen 80;
    server_name other.example.com;
}
`;
  const incoming = buildConfDContent(FULL_CONFIG, INCLUDE_PATH);
  assert.equal(findServerNameConflicts(existing, incoming).length, 0);
});

test('findServerNameConflicts reports listen collision across default servers', () => {
  const existing = `server {
    listen 80 default_server;
    server_name _;
}
`;
  const incoming = buildConfDContent(FULL_CONFIG, INCLUDE_PATH);
  const conflicts = findServerNameConflicts(existing, incoming);
  assert.ok(conflicts.length >= 1);
});

test('CLI --check-conflicts ignores the incoming file itself and flags real collisions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-nginx-'));
  const incoming = buildConfDContent(FULL_CONFIG, INCLUDE_PATH);
  const incomingPath = join(dir, 'workflow.conf');
  writeFileSync(incomingPath, incoming);
  // another conf.d file with the same server_name → real conflict
  writeFileSync(
    join(dir, 'other.conf'),
    `server {
    listen 80;
    server_name app.example.com;
    location /other/ { proxy_pass http://127.0.0.1:9999; }
}
`
  );
  const script = new URL('../deploy/scripts/nginx-wiring.mjs', import.meta.url).pathname;
  const res = spawnSync(process.execPath, [script, '--check-conflicts', dir, incomingPath], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 1, 'conflict must fail');
  assert.match(res.stderr, /CONFLICT: other\.conf/);
  assert.doesNotMatch(res.stderr, /workflow\.conf/);
});

test('CLI --check-conflicts passes when only the incoming file matches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-nginx-'));
  const incoming = buildConfDContent(FULL_CONFIG, INCLUDE_PATH);
  const incomingPath = join(dir, 'workflow.conf');
  writeFileSync(incomingPath, incoming);
  // a copy of the same content under a different name = idempotent re-run,
  // not a conflict (incoming may live outside the dir during testing)
  writeFileSync(join(dir, 'site-copy.conf'), incoming);
  const script = new URL('../deploy/scripts/nginx-wiring.mjs', import.meta.url).pathname;
  const res = spawnSync(process.execPath, [script, '--check-conflicts', dir, incomingPath], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, 'no conflict expected');
  assert.match(res.stdout, /no server_name conflicts/);
});

test('CLI conversion writes a conf.d fragment from a standalone config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-nginx-'));
  const src = join(dir, 'standalone.conf');
  const dst = join(dir, 'site.conf');
  writeFileSync(src, FULL_CONFIG);
  const script = new URL('../deploy/scripts/nginx-wiring.mjs', import.meta.url).pathname;
  const res = spawnSync(
    process.execPath,
    [script, src, dst, INCLUDE_PATH, '--server-name', 'app.example.com'],
    { encoding: 'utf8' }
  );
  assert.equal(res.status, 0, res.stderr);
  const out = readFileSync(dst, 'utf8');
  assert.ok(out.includes('server_name app.example.com'));
  assert.ok(out.includes(`include ${INCLUDE_PATH};`));
  assert.ok(!out.includes('listen 8888'));
  assert.ok(!out.includes('events {'));
});
