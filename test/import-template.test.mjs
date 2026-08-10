import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { importTemplate } from '../deploy/import-template.mjs';

/**
 * #294: idempotent template import (deploy/import-template.mjs).
 *
 * Pins the three outcomes: create when absent, skip when present (no
 * --update), overwrite when present with --update.
 */

const TEMPLATE_PATH = join(import.meta.dirname, '..', 'deploy', 'templates', 'feishu-reply.json');
const DATA = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));

function fakeFetch(routes) {
  return async (url, options = {}) => {
    const entry = routes[`${options.method ?? 'GET'} ${url}`] ?? routes[`GET ${url}`];
    if (!entry) throw new Error(`unexpected call: ${options.method ?? 'GET'} ${url}`);
    const res = new Response(JSON.stringify(entry.body), { status: entry.status ?? 200 });
    return res;
  };
}

test('creates the workflow when no same-name workflow exists', async () => {
  const fetchImpl = fakeFetch({
    'GET http://localhost:4000/workflows': { body: [] },
    'POST http://localhost:4000/workflows': { body: { id: 'wf_new' }, status: 201 },
  });
  const result = await importTemplate({
    baseUrl: 'http://localhost:4000',
    name: 'Feishu Echo Reply',
    data: DATA,
    fetchImpl,
  });
  assert.deepEqual(result, { action: 'created', id: 'wf_new', status: 201 });
});

test('skips when a same-name workflow exists (no --update)', async () => {
  const fetchImpl = fakeFetch({
    'GET http://localhost:4000/workflows': {
      body: [{ id: 'wf_existing', name: 'Feishu Echo Reply' }],
    },
  });
  const result = await importTemplate({
    baseUrl: 'http://localhost:4000/',
    name: 'Feishu Echo Reply',
    data: DATA,
    fetchImpl,
  });
  assert.deepEqual(result, { action: 'skipped', id: 'wf_existing' });
});

test('overwrites when --update and a same-name workflow exists', async () => {
  const fetchImpl = fakeFetch({
    'GET http://localhost:4000/workflows': {
      body: [{ id: 'wf_existing', name: 'Feishu Echo Reply' }],
    },
    'PUT http://localhost:4000/workflows/wf_existing': { body: { id: 'wf_existing' } },
  });
  const result = await importTemplate({
    baseUrl: 'http://localhost:4000',
    name: 'Feishu Echo Reply',
    data: DATA,
    update: true,
    fetchImpl,
  });
  assert.deepEqual(result, { action: 'updated', id: 'wf_existing', status: 200 });
});

test('propagates list endpoint failures', async () => {
  const fetchImpl = fakeFetch({
    'GET http://localhost:4000/workflows': { body: { error: 'boom' }, status: 500 },
  });
  await assert.rejects(
    importTemplate({ baseUrl: 'http://localhost:4000', name: 'n', data: DATA, fetchImpl }),
    /HTTP 500/
  );
});
