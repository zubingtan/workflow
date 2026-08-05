#!/usr/bin/env node
/**
 * Provider capability probe (#251) — which models honor
 * response_format.json_schema (Structured Outputs)?
 *
 * Capability is determined by endpoint behavior, never by name guessing:
 * each model is probed with an actual Chat Completions request carrying the
 * same payload shape the extension injects (strict json_schema), plus a
 * json_object-only probe to distinguish JSON-Mode-only endpoints.
 *
 * Usage:
 *   node scripts/probe-structured-output-capability.mjs \
 *     [--base https://open-webui.corp.pony.ai/api/v1] \
 *     [--key $LLM_API_KEY] \
 *     [--models gpt-4o-mini,qwen3.6-plus]
 *
 * The key defaults to $LLM_API_KEY (the repo `.env` value). Results are
 * printed as a per-model matrix; the consolidated table lives in
 * docs/structured-output-capability-matrix.md.
 */

function parseArgs(argv) {
  const args = { base: 'https://open-webui.corp.pony.ai/api/v1', key: process.env.LLM_API_KEY };
  const defaultModels = [
    'gpt-4o-mini',
    'gpt-5.5',
    'deepseek-v4-flash',
    'deepseek-v4-pro',
    'qwen3.5-flash',
    'qwen3.6-plus',
    'qwen3.7-max',
    'qwen3.8-max',
    'claude-sonnet-5',
    'kimi-k3',
    'glm-5.2',
    'doubao-seed-2.0-lite',
  ];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i];
    else if (argv[i] === '--key') args.key = argv[++i];
    else if (argv[i] === '--models') args.models = argv[++i].split(',');
  }
  args.models ??= defaultModels;
  return args;
}

const SCHEMA = {
  type: 'object',
  required: ['result', 'n'],
  additionalProperties: false,
  properties: { result: { type: 'string' }, n: { type: 'integer' } },
};

/** @returns {'ok'|string} 'ok' when the endpoint honored the payload, else the error text. */
async function probe(base, key, model, body) {
  const started = Date.now();
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const ms = Date.now() - started;
    if (res.ok) {
      let content = '';
      try {
        content = JSON.parse(text).choices?.[0]?.message?.content ?? '';
      } catch {}
      return `ok (${ms}ms) ${content.slice(0, 40)}`;
    }
    return `FAIL ${res.status} (${ms}ms): ${text.slice(0, 100).replace(/\n/g, ' ')}`;
  } catch (err) {
    return `ERR: ${err.message}`;
  }
}

function schemaBody(model, stream) {
  return {
    model,
    messages: [{ role: 'user', content: 'Respond with ONLY the JSON: {"result":"hello","n":1}' }],
    stream,
    max_tokens: 200,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'probe', strict: true, schema: SCHEMA },
    },
  };
}

function jsonObjectBody(model) {
  return {
    model,
    messages: [{ role: 'user', content: 'Respond with ONLY the JSON: {"result":"hello","n":1}' }],
    stream: false,
    max_tokens: 200,
    response_format: { type: 'json_object' },
  };
}

const { base, key, models } = parseArgs(process.argv.slice(2));
if (!key) {
  console.error('No API key: pass --key or export LLM_API_KEY (see .env).');
  process.exit(1);
}

console.log(`Base: ${base}\n`);
console.log('model'.padEnd(24), 'json_schema stream:false'.padEnd(34), 'json_schema stream:true'.padEnd(32), 'json_object');
for (const model of models) {
  const sf = await probe(base, key, model, schemaBody(model, false));
  const st = await probe(base, key, model, schemaBody(model, true));
  const jo = await probe(base, key, model, jsonObjectBody(model));
  console.log(model.padEnd(24), sf.slice(0, 32).padEnd(34), st.slice(0, 30).padEnd(32), jo.slice(0, 60));
}
