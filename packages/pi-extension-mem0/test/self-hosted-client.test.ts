/**
 * Seam 1 (#212): SelfHostedMemoryClient unit tests.
 *
 * A real node:http mock server stands in for the self-hosted mem0 API so we
 * verify wire behavior, not implementation details:
 *   - URL paths: POST /memories, POST /search, GET /memories, PUT/DELETE
 *     /memories/{id}, DELETE /memories (no /v1/ or /v3/ prefixes — D5)
 *   - Auth header: X-API-Key (not Authorization: Token — D5)
 *   - getAll uses GET + query params (not POST + body — D5)
 *   - snake_case → camelCase response conversion (D5)
 *   - deleteAll admin-role 403 surfaces as an error (D5)
 *   - cloud-only params are never sent (customCategories / rerank / output_format)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SelfHostedMemoryClient } from '../src/client.ts';

interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (raw += c));
    req.once('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch (e) {
        reject(e);
      }
    });
    req.once('error', reject);
  });
}

const MEMORY_ROW = {
  id: 'mem_1',
  memory: 'User prefers pnpm over npm',
  user_id: 'u1',
  agent_id: 'a1',
  run_id: 'r1',
  hash: 'abc',
  metadata: { source: 'e2e' },
  created_at: '2026-07-30T10:00:00Z',
  updated_at: '2026-07-30T10:00:00Z',
};

describe('SelfHostedMemoryClient', () => {
  let server: Server;
  let baseUrl: string;
  const requests: RecordedRequest[] = [];
  /** Handler hook: tests can override behavior per test. */
  let handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

  beforeEach(async () => {
    requests.length = 0;
    handler = async (req, res) => json(res, 404, { detail: 'not found' });
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const body = await readJson(req);
      requests.push({
        method: req.method ?? '',
        path: url.pathname + url.search,
        headers: req.headers,
        body,
      });
      await handler(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  });

  function client(apiKey = 'admin-key'): SelfHostedMemoryClient {
    return new SelfHostedMemoryClient({ host: baseUrl, apiKey });
  }

  describe('add', () => {
    it('POSTs to /memories (no /v1/ prefix) with X-API-Key and snake_case body', async () => {
      handler = async (_req, res) =>
        json(res, 200, { results: [{ id: 'mem_1', memory: 'User prefers pnpm', event: 'add' }] });

      const out = await client().add([{ role: 'user', content: 'I prefer pnpm over npm' }], {
        agent_id: 'a1',
        run_id: 'r1',
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('POST');
      expect(requests[0].path).toBe('/memories');
      expect(requests[0].headers['x-api-key']).toBe('admin-key');
      expect(requests[0].headers.authorization).toBeUndefined();
      expect(requests[0].body).toEqual({
        messages: [{ role: 'user', content: 'I prefer pnpm over npm' }],
        agent_id: 'a1',
        run_id: 'r1',
      });
      expect(out).toEqual({
        results: [{ id: 'mem_1', memory: 'User prefers pnpm', event: 'add' }],
      });
    });

    it('omits cloud-only customCategories / rerank / output_format from the body', async () => {
      handler = async (_req, res) => json(res, 200, { results: [] });

      await client().add([{ role: 'user', content: 'hi' }], {
        agent_id: 'a1',
        customCategories: [{ identity: 'x' }],
      } as never);

      const body = requests[0].body as Record<string, unknown>;
      expect(body).not.toHaveProperty('custom_categories');
      expect(body).not.toHaveProperty('customCategories');
    });

    it('surfaces non-2xx responses as errors', async () => {
      handler = async (_req, res) =>
        json(res, 400, { detail: 'At least one identifier is required.' });

      await expect(client().add([{ role: 'user', content: 'hi' }], {})).rejects.toThrow(/400/);
    });
  });

  describe('search', () => {
    it('POSTs to /search with filters mapped to snake_case + threshold/topK', async () => {
      handler = async (_req, res) =>
        json(res, 200, {
          results: [
            {
              id: 'mem_2',
              memory: "User's favorite color is blue",
              user_id: 'u1',
              agent_id: 'a1',
              created_at: '2026-07-30T10:00:00Z',
            },
          ],
        });

      const out = await client().search('favorite color', {
        filters: { agent_id: 'a1' },
        threshold: 0.3,
        topK: 5,
      });

      expect(requests[0].method).toBe('POST');
      expect(requests[0].path).toBe('/search');
      expect(requests[0].headers['x-api-key']).toBe('admin-key');
      expect(requests[0].body).toEqual({
        query: 'favorite color',
        filters: { agent_id: 'a1' },
        threshold: 0.3,
        top_k: 5,
      });
      expect(out.results).toHaveLength(1);
      expect(out.results[0].memory).toBe("User's favorite color is blue");
      expect(out.results[0].id).toBe('mem_2');
    });

    it('converts snake_case memory rows to camelCase', async () => {
      handler = async (_req, res) => json(res, 200, { results: [MEMORY_ROW] });

      const out = await client().search('pm', { filters: { agent_id: 'a1' } });

      expect(out.results[0]).toMatchObject({
        id: 'mem_1',
        memory: 'User prefers pnpm over npm',
        userId: 'u1',
        agentId: 'a1',
        runId: 'r1',
        createdAt: '2026-07-30T10:00:00Z',
        updatedAt: '2026-07-30T10:00:00Z',
      });
      expect(out.results[0]).not.toHaveProperty('user_id');
    });

    it('sends top-level filters for agent-scoped recall (agent_id isolation — D3)', async () => {
      handler = async (_req, res) => json(res, 200, { results: [] });

      await client().search('anything', { filters: { agent_id: 'agent-42', run_id: 'run-7' } });

      expect((requests[0].body as { filters: object }).filters).toEqual({
        agent_id: 'agent-42',
        run_id: 'run-7',
      });
    });
  });

  describe('getAll', () => {
    it('uses GET /memories with query params (NOT POST + body)', async () => {
      handler = async (_req, res) => json(res, 200, { results: [MEMORY_ROW], count: 1 });

      const out = await client().getAll({ filters: { agent_id: 'a1', run_id: 'r1' } });

      expect(requests[0].method).toBe('GET');
      expect(requests[0].path).toBe('/memories?agent_id=a1&run_id=r1');
      expect(requests[0].body).toBeNull();
      expect(out.results[0].createdAt).toBe('2026-07-30T10:00:00Z');
      expect(out.count).toBe(1);
    });

    it('passes limit as top_k query param', async () => {
      handler = async (_req, res) => json(res, 200, { results: [] });

      await client().getAll({ filters: { agent_id: 'a1' }, limit: 50 });

      expect(requests[0].path).toBe('/memories?agent_id=a1&top_k=50');
    });
  });

  describe('update', () => {
    it('PUTs to /memories/{id} with {text}', async () => {
      handler = async (_req, res) => json(res, 200, { message: 'Memory updated successfully' });

      const out = await client().update('mem_1', { text: 'new text' });

      expect(requests[0].method).toBe('PUT');
      expect(requests[0].path).toBe('/memories/mem_1');
      expect(requests[0].body).toEqual({ text: 'new text' });
      expect(out).toEqual({ message: 'Memory updated successfully' });
    });
  });

  describe('delete', () => {
    it('DELETEs /memories/{id}', async () => {
      handler = async (_req, res) => json(res, 200, { message: 'Memory deleted successfully' });

      const out = await client().delete('mem_1');

      expect(requests[0].method).toBe('DELETE');
      expect(requests[0].path).toBe('/memories/mem_1');
      expect(out).toEqual({ message: 'Memory deleted successfully' });
    });
  });

  describe('deleteAll', () => {
    it('DELETEs /memories with agent_id query param (admin endpoint)', async () => {
      handler = async (_req, res) => json(res, 200, { message: 'All relevant memories deleted' });

      const out = await client().deleteAll({ agent_id: 'a1' });

      expect(requests[0].method).toBe('DELETE');
      expect(requests[0].path).toBe('/memories?agent_id=a1');
      expect(out).toEqual({ message: 'All relevant memories deleted' });
    });

    it('surfaces admin-role 403 (non-admin X-API-Key) as an error', async () => {
      handler = async (_req, res) =>
        json(res, 403, { detail: 'Admin role required to delete all memories.' });

      await expect(client('non-admin-key').deleteAll({ agent_id: 'a1' })).rejects.toThrow(/403/);
    });
  });

  describe('error handling', () => {
    it('rejects on network failure without blocking the caller', async () => {
      const dead = new SelfHostedMemoryClient({ host: 'http://127.0.0.1:1', apiKey: 'k' });
      await expect(dead.search('q', { filters: { agent_id: 'a' } })).rejects.toThrow();
    });

    it('times out a hung server instead of blocking forever (D10)', async () => {
      handler = async () => {
        // Never respond — simulate a half-open connection.
        await new Promise(() => {});
      };
      const slow = new SelfHostedMemoryClient({ host: baseUrl, apiKey: 'k', timeoutMs: 200 });
      await expect(slow.search('q', { filters: { agent_id: 'a' } })).rejects.toThrow(/abort/i);
    });
  });
});
