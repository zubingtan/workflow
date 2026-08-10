#!/usr/bin/env node
/**
 * #294: idempotent Feishu workflow template import.
 *
 * POST /workflows takes a full {name, data} document, so a template ships as
 * a plain JSON file and this script drives the import against a running
 * workflow instance. Idempotent by name: skip when a workflow with the same
 * name already exists (--update overwrites it instead).
 *
 * Usage:
 *   node import-template.mjs \
 *     --base http://localhost:4000/workflow \
 *     [--update] [--name "Feishu Echo Reply"] [--template deploy/templates/feishu-reply.json]
 *
 * NOTE: --base must include the app's BASE_PATH prefix (the deployed instance
 * serves everything under /workflow, #297) — root paths 404 there.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_NAME = 'Feishu Echo Reply';
const DEFAULT_TEMPLATE = join(import.meta.dirname, 'templates', 'feishu-reply.json');

function parseArgs(argv) {
  const args = {
    base: 'http://localhost:4000/workflow',
    name: DEFAULT_NAME,
    template: DEFAULT_TEMPLATE,
  };
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case '--base':
        args.base = argv[++i];
        break;
      case '--name':
        args.name = argv[++i];
        break;
      case '--template':
        args.template = argv[++i];
        break;
      case '--update':
        args.update = true;
        break;
      default:
        break;
    }
  }
  return args;
}

/**
 * Import a workflow template idempotently (by name).
 *
 * @param {object} opts
 * @param {string} opts.baseUrl - workflow instance base (e.g. http://localhost:4000)
 * @param {string} opts.name - workflow name to match on
 * @param {object} opts.data - workflow document (nodes + edges)
 * @param {boolean} [opts.update=false] - overwrite an existing workflow with
 *   the same name instead of skipping it
 * @param {typeof fetch} [opts.fetchImpl=fetch] - injectable for tests
 * @returns {Promise<{action: 'created'|'skipped'|'updated', id?: string, status?: number}>}
 */
export async function importTemplate({ baseUrl, name, data, update = false, fetchImpl = fetch }) {
  const base = baseUrl.replace(/\/+$/, '');
  const listRes = await fetchImpl(`${base}/workflows`);
  if (!listRes.ok) throw new Error(`GET ${base}/workflows failed: HTTP ${listRes.status}`);
  const workflows = await listRes.json();
  const existing = workflows.find((w) => w.name === name);

  if (existing && !update) {
    return { action: 'skipped', id: existing.id };
  }
  if (existing) {
    const res = await fetchImpl(`${base}/workflows/${existing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    return { action: 'updated', id: existing.id, status: res.status };
  }
  const res = await fetchImpl(`${base}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data }),
  });
  const body = await res.json().catch(() => ({}));
  return { action: 'created', id: body.id, status: res.status };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const data = JSON.parse(readFileSync(args.template, 'utf8'));
  importTemplate({ baseUrl: args.base, name: args.name, data, update: args.update })
    .then((result) => {
      console.log(`[import-template] ${result.action}${result.id ? `: ${result.id}` : ''}`);
      if (result.status && result.status >= 400) {
        console.error(`[import-template] HTTP ${result.status}`);
        process.exitCode = 1;
      }
    })
    .catch((err) => {
      console.error(`[import-template] failed: ${err.message}`);
      process.exitCode = 1;
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
