/**
 * Fake self-hosted mem0 server for E2E (map #198 → spec #212, seam 3).
 *
 * Implements the subset of the self-hosted REST API the pi-extension-mem0
 * fork uses (D5), backed by in-memory storage:
 *
 *   POST   /memories               — add (extracts memory from message texts)
 *   POST   /search                 — search (case-insensitive substring match)
 *   GET    /memories?agent_id=…    — get_all
 *   PUT    /memories/{id}          — update
 *   DELETE /memories/{id}          — delete
 *   DELETE /memories?agent_id=…    — delete_all (admin)
 *   GET    /health/live            — liveness (E2E readiness)
 *   GET    /test/stats             — request log + memory dump for assertions
 *   DELETE /test/stats             — reset state
 *
 * Auth mirrors the real server: `X-API-Key` header; when MEM0_API_KEY is
 * set, requests without it (or with a different one) get 401. E2E uses a
 * dedicated port (8890, overridable via FAKE_MEM0_PORT) so it never clashes
 * with a locally running mem0 instance (user story 11).
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.FAKE_MEM0_PORT ?? 8890);
const expectedKey = process.env.MEM0_API_KEY ?? "e2e-mem0-key";

/** @type {Array<{id:string,memory:string,user_id?:string,agent_id?:string,run_id?:string,metadata?:object,created_at:string,updated_at:string}>} */
const memories = [];
/** @type {Array<{method:string,path:string,headers:object,body:unknown}>} */
const requestLog = [];

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let source = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { source += chunk; });
    request.once("end", () => {
      try {
        resolve(source ? JSON.parse(source) : null);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.once("error", reject);
  });
}

function authorized(request) {
  return request.headers["x-api-key"] === expectedKey;
}

function serialize(mem) {
  return { ...mem };
}

/** Extract memory texts from an add payload's messages (user messages only). */
function extractMemories(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages
    .filter((m) => m?.role === "user" && typeof m?.content === "string")
    .map((m) => m.content)
    .filter((t) => t.trim().length > 0);
}

/** Relevance approximation: shared substring in either direction, or a
 *  4-char n-gram overlap. The real server does semantic search; this keeps
 *  E2E queries that paraphrase the memory within reach. */
function matches(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q) || q.includes(t)) return true;
  const grams = new Set();
  for (let i = 0; i + 4 <= t.length; i++) grams.add(t.slice(i, i + 4));
  for (let i = 0; i + 4 <= q.length; i++) {
    if (grams.has(q.slice(i, i + 4))) return true;
  }
  return false;
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const method = request.method ?? "GET";
  const path = url.pathname;
  const body = method === "GET" || method === "DELETE" ? null : await readJson(request);
  requestLog.push({ method, path: path + url.search, headers: request.headers, body });

  // --- Health / test controls ---
  if (method === "GET" && path === "/health/live") {
    json(response, 200, { status: "live" });
    return;
  }
  if (path === "/test/stats") {
    if (method === "GET") {
      json(response, 200, {
        memories: memories.map(serialize),
        requestCount: requestLog.length,
        requests: requestLog,
      });
      return;
    }
    if (method === "DELETE") {
      memories.length = 0;
      requestLog.length = 0;
      json(response, 200, { status: "reset" });
      return;
    }
  }

  // --- Auth (memories endpoints require X-API-Key) ---
  if (!authorized(request)) {
    json(response, 401, { detail: "Authentication required. Provide an X-API-Key header." });
    return;
  }

  // --- POST /memories (add) ---
  if (method === "POST" && path === "/memories") {
    const texts = extractMemories(body);
    const created = [];
    for (const text of texts) {
      const mem = {
        id: `mem_${randomUUID()}`,
        memory: text,
        user_id: body?.user_id ?? undefined,
        agent_id: body?.agent_id ?? undefined,
        run_id: body?.run_id ?? undefined,
        metadata: body?.metadata ?? {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      memories.push(mem);
      created.push(serialize(mem));
    }
    json(response, 200, { results: created });
    return;
  }

  // --- POST /search ---
  if (method === "POST" && path === "/search") {
    const filters = body?.filters ?? {};
    const threshold = typeof body?.threshold === "number" ? body.threshold : 0.3;
    const topK = typeof body?.top_k === "number" ? body.top_k : 10;
    const query = typeof body?.query === "string" ? body.query : "";
    let hits = memories.filter((m) => {
      if (filters.agent_id && m.agent_id !== filters.agent_id) return false;
      if (filters.run_id && m.run_id !== filters.run_id) return false;
      if (filters.user_id && m.user_id !== filters.user_id) return false;
      if (filters.agent_id === "*" && !m.agent_id) return false;
      return matches(m.memory, query);
    });
    if (threshold > 0) {
      // matches() already did relevance gating; score 1.0 for hits so the
      // client's threshold plumbing is exercised without re-implementing
      // semantic scoring.
      hits = hits.map((m) => ({
        ...serialize(m),
        score: 1.0,
      })).filter((m) => m.score >= threshold);
    }
    json(response, 200, { results: hits.slice(0, topK) });
    return;
  }

  // --- GET /memories (get_all) ---
  if (method === "GET" && path === "/memories") {
    const agentId = url.searchParams.get("agent_id");
    const runId = url.searchParams.get("run_id");
    const userId = url.searchParams.get("user_id");
    let rows = memories.filter((m) => {
      if (agentId && m.agent_id !== agentId) return false;
      if (runId && m.run_id !== runId) return false;
      if (userId && m.user_id !== userId) return false;
      return true;
    });
    const topK = url.searchParams.get("top_k");
    if (topK) rows = rows.slice(0, Number(topK));
    json(response, 200, { results: rows.map(serialize), count: rows.length });
    return;
  }

  // --- PUT /memories/{id} (update) ---
  const singleMatch = path.match(/^\/memories\/([^/]+)$/);
  if (singleMatch) {
    const id = decodeURIComponent(singleMatch[1]);
    const mem = memories.find((m) => m.id === id);
    if (!mem) {
      json(response, 404, { detail: "Memory not found" });
      return;
    }
    if (method === "PUT") {
      if (typeof body?.text === "string") {
        mem.memory = body.text;
        mem.updated_at = new Date().toISOString();
      }
      json(response, 200, { message: "Memory updated successfully" });
      return;
    }
    if (method === "DELETE") {
      memories.splice(memories.indexOf(mem), 1);
      json(response, 200, { message: "Memory deleted successfully" });
      return;
    }
  }

  // --- DELETE /memories (delete_all, admin) ---
  if (method === "DELETE" && path === "/memories") {
    const agentId = url.searchParams.get("agent_id");
    const runId = url.searchParams.get("run_id");
    const userId = url.searchParams.get("user_id");
    if (!agentId && !runId && !userId) {
      json(response, 400, { detail: "At least one identifier is required." });
      return;
    }
    for (let i = memories.length - 1; i >= 0; i--) {
      const m = memories[i];
      if (agentId && m.agent_id !== agentId) continue;
      if (runId && m.run_id !== runId) continue;
      if (userId && m.user_id !== userId) continue;
      memories.splice(i, 1);
    }
    json(response, 200, { message: "All relevant memories deleted" });
    return;
  }

  json(response, 404, { detail: "Not found" });
}

createServer(async (request, response) => {
  try {
    await handle(request, response);
  } catch (err) {
    json(response, 500, { detail: err?.message ?? "internal error" });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`fake mem0 server listening on ${port}`);
});
