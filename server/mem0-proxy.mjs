/**
 * mem0 proxy — thin server-side forwarding layer between the workflow app and
 * the self-hosted mem0 server.
 *
 * Rationale: the browser must never hold the mem0 API key. All mem0 calls go
 * through these endpoints; the key is read from the settings table server-side.
 *
 * Every endpoint reuses mem0's existing REST API — no new mem0-side code.
 */

import {
  getMem0Host,
  getMem0ApiKey,
  getMem0AdminKey,
  getMem0LlmBaseUrl,
  getMem0LlmModel,
  getMem0EmbedderModel,
  getMem0EmbeddingDims,
} from "./settings.mjs";

/** Resolve the mem0 connection config from settings. Returns null when unset. */
export function resolveMem0Config(db) {
  const host = getMem0Host(db);
  const apiKey = getMem0ApiKey(db);
  if (!host || !apiKey) return null;
  return { host, apiKey, adminKey: getMem0AdminKey(db) ?? apiKey, db };
}

function mem0Headers(apiKey) {
  return {
    "X-API-Key": apiKey,
    "Content-Type": "application/json",
    // Connection: close keeps each request independent (no keep-alive pool),
    // which makes server shutdown/test teardown deterministic.
    Connection: "close",
  };
}

/**
 * GET {host}/auth/setup-status — connectivity check (no auth required).
 * Returns { ok, status } where status is the raw body.
 */
export async function checkMem0Status(mem0) {
  const res = await fetch(`${mem0.host}/auth/setup-status`, {
    headers: mem0Headers(mem0.apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/**
 * GET {host}/configure — read the mem0 server's current LLM/embedding config.
 * Returns { ok, status, body }.
 */
export async function getMem0Config(mem0) {
  const res = await fetch(`${mem0.host}/configure`, {
    headers: mem0Headers(mem0.apiKey),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/**
 * GET {host}/memories?agent_id=... — list memories for one agent.
 * Returns { ok, results } (results is the raw mem0 response body).
 */
export async function listAgentMemories(mem0, agentId) {
  const res = await fetch(
    `${mem0.host}/memories?agent_id=${encodeURIComponent(agentId)}`,
    { headers: mem0Headers(mem0.apiKey), signal: AbortSignal.timeout(10_000) }
  );
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/**
 * POST {host}/configure — push LLM/embedding configuration to the mem0 server.
 * Requires the admin key. Body shape follows mem0's /configure contract:
 *   { llm: { provider: "openai", config: { model, openai_base_url } },
 *     embedder: { provider: "openai", config: { model, openai_base_url, embedding_dims } } }
 * `settings` carries the values already resolved by the caller (from the
 * workflow settings table); absent keys fall back to current stored values.
 */
export async function configureMem0(mem0, settings) {
  const patch = {};
  const llmBaseUrl = settings.llmBaseUrl ?? getMem0LlmBaseUrl(mem0.db);
  const llmModel = settings.llmModel ?? getMem0LlmModel(mem0.db);
  const embedderModel = settings.embedderModel ?? getMem0EmbedderModel(mem0.db);
  const embeddingDims = settings.embeddingDims ?? getMem0EmbeddingDims(mem0.db);

  if (llmBaseUrl || llmModel) {
    patch.llm = {
      provider: "openai",
      config: {
        ...(llmModel ? { model: llmModel } : {}),
        ...(llmBaseUrl ? { openai_base_url: llmBaseUrl } : {}),
      },
    };
  }
  if (embedderModel || llmBaseUrl || embeddingDims) {
    patch.embedder = {
      provider: "openai",
      config: {
        ...(embedderModel ? { model: embedderModel } : {}),
        ...(llmBaseUrl ? { openai_base_url: llmBaseUrl } : {}),
        ...(embeddingDims ? { embedding_dims: embeddingDims } : {}),
      },
    };
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, status: 400, body: { detail: "no mem0 llm/embedder settings configured" } };
  }

  const res = await fetch(`${mem0.host}/configure`, {
    method: "POST",
    headers: mem0Headers(mem0.adminKey),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/**
 * POST /api/mem0/test — minimal end-to-end connectivity test.
 * Steps (all reuse mem0's existing endpoints):
 *   1. GET /auth/setup-status          → server reachable
 *   2. POST /memories (test message)   → LLM extraction works
 *   3. POST /search (test query)       → embedding + retrieval works
 *   4. DELETE /memories/{id}           → cleanup test memory
 * Returns { ok, steps: [{name, ok, detail}] }.
 */
export async function runMem0Test(mem0) {
  const steps = [];

  // Step 1: connectivity
  try {
    const status = await checkMem0Status(mem0);
    steps.push({
      name: "connect",
      ok: status.ok,
      detail: status.ok ? `mem0 reachable (HTTP ${status.status})` : `HTTP ${status.status}: ${JSON.stringify(status.body)}`,
    });
    if (!status.ok) return { ok: false, steps };
  } catch (err) {
    steps.push({ name: "connect", ok: false, detail: err.message });
    return { ok: false, steps };
  }

  // Step 2: memory extraction (LLM)
  const testAgentId = `mem0-test-${Date.now()}`;
  let memoryId = null;
  try {
    const addRes = await fetch(`${mem0.host}/memories`, {
      method: "POST",
      headers: mem0Headers(mem0.apiKey),
      body: JSON.stringify({
        messages: [{ role: "user", content: "My favorite color is blue and I like pizza." }],
        agent_id: testAgentId,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const addBody = await addRes.json().catch(() => ({}));
    memoryId = addBody.results?.[0]?.id ?? null;
    const extracted = addBody.results?.[0]?.memory ?? "";
    steps.push({
      name: "extract",
      ok: addRes.ok,
      detail: addRes.ok
        ? `LLM extracted: "${extracted.slice(0, 80)}"`
        : `HTTP ${addRes.status}: ${JSON.stringify(addBody)}`,
    });
    if (!addRes.ok) return { ok: false, steps };
  } catch (err) {
    steps.push({ name: "extract", ok: false, detail: err.message });
    return { ok: false, steps };
  }

  // Step 3: semantic search (embedding + retrieval)
  try {
    const searchRes = await fetch(`${mem0.host}/search`, {
      method: "POST",
      headers: mem0Headers(mem0.apiKey),
      body: JSON.stringify({
        query: "what is my favorite color?",
        filters: { agent_id: testAgentId },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const searchBody = await searchRes.json().catch(() => ({}));
    const results = Array.isArray(searchBody.results) ? searchBody.results : [];
    const hit = results.find((r) => (r.memory ?? "").toLowerCase().includes("blue"));
    steps.push({
      name: "search",
      ok: searchRes.ok && hit !== undefined,
      detail: searchRes.ok
        ? hit
          ? `semantic search hit "${(hit.memory ?? "").slice(0, 80)}" (score ${hit.score?.toFixed?.(3) ?? "n/a"})`
          : `search returned ${results.length} results but none matched the test fact`
        : `HTTP ${searchRes.status}: ${JSON.stringify(searchBody)}`,
    });
  } catch (err) {
    steps.push({ name: "search", ok: false, detail: err.message });
  }

  // Step 4: cleanup (best-effort, never fails the test)
  if (memoryId) {
    try {
      await fetch(`${mem0.host}/memories/${memoryId}`, {
        method: "DELETE",
        headers: mem0Headers(mem0.apiKey),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      /* best-effort */
    }
  }

  const ok = steps.every((s) => s.ok);
  return { ok, steps };
}
