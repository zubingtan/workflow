import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── Config ──────────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  let tmpDir: string;
  let configPath: string;
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem0-test-'));
    configPath = path.join(tmpDir, 'mem0-config.json');
    for (const key of ['MEM0_CONFIG_PATH', 'MEM0_API_KEY', 'MEM0_HOST', 'MEM0_AGENT_ID']) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it('returns defaults when no config file exists', async () => {
    process.env.MEM0_CONFIG_PATH = path.join(tmpDir, 'nonexistent.json');
    const { loadConfig } = await import('../src/config/index.js');
    const config = loadConfig();
    assert.equal(config.host, 'http://localhost:8019');
    assert.equal(config.apiKey, '');
    assert.equal(config.agentId, '');
    assert.equal(config.autoCapture, true);
    assert.equal(config.defaultScope, 'agent');
    assert.equal(config.contextInjection, true);
    assert.equal(config.dream.enabled, false);
  });

  it('reads config from MEM0_CONFIG_PATH', async () => {
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        host: 'http://mem0:8019',
        apiKey: 'test-key',
        agentId: 'agent-42',
      })
    );
    process.env.MEM0_CONFIG_PATH = configPath;
    const { loadConfig } = await import('../src/config/index.js');
    const config = loadConfig();
    assert.equal(config.host, 'http://mem0:8019');
    assert.equal(config.apiKey, 'test-key');
    assert.equal(config.agentId, 'agent-42');
  });

  it('env vars override file config', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ host: 'http://file:8019', apiKey: 'file-key' }));
    process.env.MEM0_CONFIG_PATH = configPath;
    process.env.MEM0_HOST = 'http://env:9999';
    process.env.MEM0_API_KEY = 'env-key';
    process.env.MEM0_AGENT_ID = 'env-agent';
    const { loadConfig } = await import('../src/config/index.js');
    const config = loadConfig();
    assert.equal(config.host, 'http://env:9999');
    assert.equal(config.apiKey, 'env-key');
    assert.equal(config.agentId, 'env-agent');
  });

  it('merges dream config with defaults', async () => {
    fs.writeFileSync(configPath, JSON.stringify({ dream: { enabled: true } }));
    process.env.MEM0_CONFIG_PATH = configPath;
    const { loadConfig } = await import('../src/config/index.js');
    const config = loadConfig();
    assert.equal(config.dream.enabled, true);
    assert.equal(config.dream.auto, false); // default preserved
    assert.equal(config.dream.minHours, 24);
  });
});

// ─── Scoping ─────────────────────────────────────────────────────────────────

describe('scoping', () => {
  it('resolveSearchFilters for agent scope', async () => {
    const { resolveSearchFilters } = await import('../src/memory/scoping.js');
    const filters = resolveSearchFilters('agent', { agentId: 'a1', runId: 'r1' });
    assert.deepEqual(filters, { agent_id: 'a1' });
  });

  it('resolveSearchFilters for session scope', async () => {
    const { resolveSearchFilters } = await import('../src/memory/scoping.js');
    const filters = resolveSearchFilters('session', { agentId: 'a1', runId: 'r1' });
    assert.deepEqual(filters, { agent_id: 'a1', run_id: 'r1' });
  });

  it('resolveAddParams for agent scope', async () => {
    const { resolveAddParams } = await import('../src/memory/scoping.js');
    const params = resolveAddParams('agent', { agentId: 'a1', runId: 'r1' });
    assert.deepEqual(params, { agentId: 'a1' });
  });

  it('resolveAddParams for session scope', async () => {
    const { resolveAddParams } = await import('../src/memory/scoping.js');
    const params = resolveAddParams('session', { agentId: 'a1', runId: 'r1' });
    assert.deepEqual(params, { agentId: 'a1', runId: 'r1' });
  });

  it('detectRunId returns hash for session file', async () => {
    const { detectRunId } = await import('../src/memory/scoping.js');
    const id = detectRunId('/some/session/file.json');
    assert.equal(id.length, 12);
    assert.match(id, /^[0-9a-f]{12}$/);
  });

  it('detectRunId returns "unknown" for undefined', async () => {
    const { detectRunId } = await import('../src/memory/scoping.js');
    assert.equal(detectRunId(undefined), 'unknown');
  });
});

// ─── extractConversation ─────────────────────────────────────────────────────

describe('extractConversation', () => {
  it('extracts text from string content', async () => {
    const { extractConversation } = await import('../src/capture/index.js');
    const result = extractConversation([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
      { role: 'system', content: 'ignored' },
    ]);
    assert.deepEqual(result, [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]);
  });

  it('extracts text from array content blocks', async () => {
    const { extractConversation } = await import('../src/capture/index.js');
    const result = extractConversation([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      },
      { role: 'assistant', content: [{ type: 'tool_use', id: '1' }] },
    ]);
    assert.deepEqual(result, [{ role: 'user', content: 'a\nb' }]);
  });

  it('returns empty for no valid messages', async () => {
    const { extractConversation } = await import('../src/capture/index.js');
    assert.deepEqual(extractConversation([]), []);
    assert.deepEqual(extractConversation([{ role: 'system', content: 'x' }]), []);
  });
});

// ─── buildRecallContext ──────────────────────────────────────────────────────

describe('buildRecallContext', () => {
  it('returns empty when disabled', async () => {
    const { buildRecallContext } = await import('../src/extension.js');
    const result = await buildRecallContext('hello', false, async () => ({ results: [] }));
    assert.equal(result, '');
  });

  it('returns empty for blank prompt', async () => {
    const { buildRecallContext } = await import('../src/extension.js');
    const result = await buildRecallContext('  ', true, async () => ({ results: [] }));
    assert.equal(result, '');
  });

  it('returns formatted memories when search succeeds', async () => {
    const { buildRecallContext } = await import('../src/extension.js');
    const result = await buildRecallContext('test query', true, async () => ({
      results: [{ id: 'm1', memory: 'User likes TypeScript' }],
    }));
    assert.ok(result.includes('<mem0-relevant-memories>'));
    assert.ok(result.includes('User likes TypeScript'));
    assert.ok(result.includes('[mem0:m1]'));
  });

  it('returns empty when search throws', async () => {
    const { buildRecallContext } = await import('../src/extension.js');
    const result = await buildRecallContext('test', true, async () => {
      throw new Error('fail');
    });
    assert.equal(result, '');
  });
});

// ─── buildToolExecute ────────────────────────────────────────────────────────

describe('buildToolExecute', () => {
  function mockClient() {
    return {
      search: async () => ({ results: [{ id: '1', memory: 'found' }] }),
      add: async () => ({ results: [{ id: '2', memory: 'added', event: 'ADD' }] }),
      getAll: async () => ({ results: [{ id: '3', memory: 'all' }], count: 1 }),
      update: async () => ({ id: '4', memory: 'updated', event: 'UPDATE' }),
      delete: async () => ({ message: 'deleted' }),
      deleteAll: async () => ({ message: 'all deleted' }),
    };
  }

  const ctx = { agentId: 'test-agent', runId: 'run-1' };

  it('search returns formatted results', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    const result = await exec({ action: 'search', query: 'test' });
    assert.ok(result.content[0].text.includes('found'));
    assert.equal((result.details as any).matchCount, 1);
  });

  it('search throws without query', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    await assert.rejects(() => exec({ action: 'search' }), /query is required/);
  });

  it('add stores memory', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    const result = await exec({ action: 'add', content: 'new fact' });
    assert.ok(result.content[0].text.includes('Memory stored'));
  });

  it('get_all lists memories', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    const result = await exec({ action: 'get_all' });
    assert.ok(result.content[0].text.includes('all'));
    assert.equal((result.details as any).totalCount, 1);
  });

  it('update requires memory_id and content', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    await assert.rejects(() => exec({ action: 'update' }), /memory_id is required/);
    await assert.rejects(() => exec({ action: 'update', memory_id: 'x' }), /content is required/);
  });

  it('delete requires memory_id', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    await assert.rejects(() => exec({ action: 'delete' }), /memory_id is required/);
  });

  it('respects aborted signal', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => exec({ action: 'search', query: 'x' }, controller.signal),
      /Cancelled/
    );
  });

  it('delete_all rejects session scope (API limitation)', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    await assert.rejects(() => exec({ action: 'delete_all', scope: 'session' }), /not supported/);
  });

  it('delete_all works with agent scope', async () => {
    const { buildToolExecute } = await import('../src/memory/tools.js');
    const exec = buildToolExecute(mockClient(), ctx, 'agent');
    const result = await exec({ action: 'delete_all' });
    assert.ok(result.content[0].text.includes('all deleted'));
  });
});

// ─── Formatting ──────────────────────────────────────────────────────────────

describe('formatting', () => {
  it('formatMemoryList returns "No memories found." for empty', async () => {
    const { formatMemoryList } = await import('../src/memory/formatting.js');
    assert.equal(formatMemoryList([]), 'No memories found.');
  });

  it('formatMemoryList numbers entries', async () => {
    const { formatMemoryList } = await import('../src/memory/formatting.js');
    const result = formatMemoryList([
      { id: 'a', memory: 'first' },
      { id: 'b', memory: 'second' },
    ]);
    assert.ok(result.includes('1. first'));
    assert.ok(result.includes('2. second'));
    assert.ok(result.includes('[mem0:a]'));
  });
});
