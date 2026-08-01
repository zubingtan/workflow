import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { SelfHostedMemoryClient, Mem0ApiError } from '../src/client.js';

// ─── Mock server ────────────────────────────────────────────────────────────

interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

let server: Server;
let baseUrl: string;
let requests: CapturedRequest[] = [];

/** Configure the next response the mock server will return. */
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };

function setResponse(status: number, body: unknown) {
  nextResponse = { status, body };
}

before(async () => {
  server = createServer((req, res) => {
    let rawBody = '';
    req.on('data', (chunk: Buffer) => {
      rawBody += chunk.toString();
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method ?? 'UNKNOWN',
        url: req.url ?? '/',
        headers: req.headers,
        body: rawBody ? JSON.parse(rawBody) : undefined,
      };
      requests.push(captured);

      res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(nextResponse.body));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  if (typeof addr === 'object' && addr !== null) {
    baseUrl = `http://127.0.0.1:${addr.port}`;
  }
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function lastRequest(): CapturedRequest {
  assert.ok(requests.length > 0, 'No requests captured');
  return requests[requests.length - 1];
}

function resetRequests() {
  requests = [];
}

function makeClient(apiKey = 'test-admin-key'): SelfHostedMemoryClient {
  return new SelfHostedMemoryClient({ host: baseUrl, apiKey });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('SelfHostedMemoryClient', () => {
  describe('auth header', () => {
    it('sends X-API-Key header on every request', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient('my-secret-key');
      await client.search('hello');
      const req = lastRequest();
      assert.equal(req.headers['x-api-key'], 'my-secret-key');
    });

    it('does NOT send Authorization header', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient();
      await client.search('test');
      const req = lastRequest();
      assert.equal(req.headers['authorization'], undefined);
    });
  });

  describe('search', () => {
    it('POSTs to /search (no /v1/ or /v3/ prefix)', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient();
      await client.search('what is TypeScript?');
      const req = lastRequest();
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/search');
    });

    it('sends query, filters, top_k, threshold in body', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient();
      await client.search('test query', {
        filters: { agent_id: 'agent-1' },
        topK: 5,
        threshold: 0.7,
      });
      const req = lastRequest();
      const body = req.body as Record<string, unknown>;
      assert.equal(body.query, 'test query');
      assert.deepEqual(body.filters, { agent_id: 'agent-1' });
      assert.equal(body.top_k, 5);
      assert.equal(body.threshold, 0.7);
    });

    it('converts snake_case response to camelCase', async () => {
      resetRequests();
      setResponse(200, {
        results: [
          {
            id: 'mem-1',
            memory: 'User prefers dark mode',
            user_id: 'u1',
            agent_id: 'a1',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            score: 0.95,
          },
        ],
      });
      const client = makeClient();
      const res = await client.search('dark mode');
      const mem = res.results[0];
      assert.equal(mem.id, 'mem-1');
      assert.equal(mem.memory, 'User prefers dark mode');
      assert.equal(mem.userId, 'u1');
      assert.equal(mem.agentId, 'a1');
      assert.equal(mem.createdAt, '2026-01-01T00:00:00Z');
      assert.equal(mem.updatedAt, '2026-01-02T00:00:00Z');
      assert.equal(mem.score, 0.95);
    });
  });

  describe('add', () => {
    it('POSTs to /memories (no prefix)', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient();
      await client.add([{ role: 'user', content: 'I like vim' }]);
      const req = lastRequest();
      assert.equal(req.method, 'POST');
      assert.equal(req.url, '/memories');
    });

    it('sends messages, agent_id, run_id in body', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient();
      await client.add(
        [
          { role: 'user', content: 'Remember: deploy on Fridays' },
          { role: 'assistant', content: 'Got it!' },
        ],
        { agentId: 'agent-42', runId: 'run-7', infer: true }
      );
      const req = lastRequest();
      const body = req.body as Record<string, unknown>;
      assert.deepEqual(body.messages, [
        { role: 'user', content: 'Remember: deploy on Fridays' },
        { role: 'assistant', content: 'Got it!' },
      ]);
      assert.equal(body.agent_id, 'agent-42');
      assert.equal(body.run_id, 'run-7');
      assert.equal(body.infer, true);
      // user_id should not be present when not provided
      assert.equal(body.user_id, undefined);
    });
  });

  describe('getAll', () => {
    it('uses GET method (not POST)', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient();
      await client.getAll({ filters: { agent_id: 'a1' } });
      const req = lastRequest();
      assert.equal(req.method, 'GET');
    });

    it('passes filters as query params', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient();
      await client.getAll({
        filters: { agent_id: 'agent-1', run_id: 'run-2' },
      });
      const req = lastRequest();
      assert.ok(req.url.startsWith('/memories?'));
      const url = new URL(req.url, baseUrl);
      assert.equal(url.searchParams.get('agent_id'), 'agent-1');
      assert.equal(url.searchParams.get('run_id'), 'run-2');
    });

    it('sends no query string when no filters', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = makeClient();
      await client.getAll();
      const req = lastRequest();
      assert.equal(req.url, '/memories');
    });

    it('converts snake_case response to camelCase', async () => {
      resetRequests();
      setResponse(200, {
        results: [{ id: 'm1', memory: 'fact', hash: 'abc', created_at: '2026-01-01' }],
        count: 1,
      });
      const client = makeClient();
      const res = await client.getAll();
      assert.equal(res.results[0].createdAt, '2026-01-01');
      assert.equal(res.count, 1);
    });
  });

  describe('update', () => {
    it('PUTs to /memories/{id}', async () => {
      resetRequests();
      setResponse(200, { id: 'm1', memory: 'updated', event: 'UPDATE' });
      const client = makeClient();
      const res = await client.update('m1', { text: 'updated memory' });
      const req = lastRequest();
      assert.equal(req.method, 'PUT');
      assert.equal(req.url, '/memories/m1');
      assert.deepEqual(req.body, { text: 'updated memory' });
      assert.equal(res.id, 'm1');
      assert.equal(res.event, 'UPDATE');
    });
  });

  describe('delete', () => {
    it('DELETEs /memories/{id}', async () => {
      resetRequests();
      setResponse(200, { message: 'Memory deleted successfully' });
      const client = makeClient();
      const res = await client.delete('m99');
      const req = lastRequest();
      assert.equal(req.method, 'DELETE');
      assert.equal(req.url, '/memories/m99');
      assert.equal(res.message, 'Memory deleted successfully');
    });
  });

  describe('deleteAll', () => {
    it('DELETEs /memories with query params', async () => {
      resetRequests();
      setResponse(200, { message: 'All memories deleted' });
      const client = makeClient();
      await client.deleteAll({ agentId: 'agent-1' });
      const req = lastRequest();
      assert.equal(req.method, 'DELETE');
      assert.ok(req.url.startsWith('/memories?'));
      const url = new URL(req.url, baseUrl);
      assert.equal(url.searchParams.get('agent_id'), 'agent-1');
    });

    it('throws Mem0ApiError with status 403 on non-admin key', async () => {
      resetRequests();
      setResponse(403, { detail: 'Admin access required' });
      const client = makeClient('non-admin-key');
      await assert.rejects(
        () => client.deleteAll({ agentId: 'agent-1' }),
        (err: unknown) => {
          assert.ok(err instanceof Mem0ApiError);
          assert.equal(err.status, 403);
          assert.deepEqual(err.body, { detail: 'Admin access required' });
          return true;
        }
      );
    });
  });

  describe('error handling', () => {
    it('throws Mem0ApiError on non-OK response', async () => {
      resetRequests();
      setResponse(500, { detail: 'Internal server error' });
      const client = makeClient();
      await assert.rejects(
        () => client.search('boom'),
        (err: unknown) => {
          assert.ok(err instanceof Mem0ApiError);
          assert.equal(err.status, 500);
          assert.equal(err.name, 'Mem0ApiError');
          return true;
        }
      );
    });
  });

  describe('URL construction', () => {
    it('strips trailing slash from host', async () => {
      resetRequests();
      setResponse(200, { results: [] });
      const client = new SelfHostedMemoryClient({
        host: `${baseUrl}/`,
        apiKey: 'k',
      });
      await client.search('test');
      const req = lastRequest();
      // Should not have double slash
      assert.equal(req.url, '/search');
    });
  });
});
