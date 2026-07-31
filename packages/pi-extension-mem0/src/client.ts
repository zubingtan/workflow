/**
 * SelfHostedMemoryClient — the ~150-line adapter that lets the upstream
 * cloud-oriented plugin code talk to a self-hosted mem0 server (D5).
 *
 * It mirrors the method signature of the mem0ai cloud SDK's MemoryClient
 * (add / search / getAll / update / delete / deleteAll) so the rest of the
 * fork (tools.ts, capture/index.ts, entry.ts) stays unchanged, but the wire
 * format differs in the three ways the research (#199) identified:
 *
 *   1. URL paths have no /v1/ or /v3/ prefix:
 *        POST   /memories               — add
 *        POST   /search                 — search
 *        GET    /memories?agent_id=…    — getAll (GET + query params, NOT
 *                                          POST + body filters)
 *        PUT    /memories/{id}          — update
 *        DELETE /memories/{id}          — delete
 *        DELETE /memories?agent_id=…    — deleteAll (admin endpoint)
 *   2. Auth is the `X-API-Key` header (per-user API key or ADMIN_API_KEY),
 *      not the cloud SDK's `Authorization: Token`.
 *   3. Responses are snake_case; they are converted to camelCase so the
 *      upstream consumers (formatting.ts, capture) see the cloud shape.
 *
 * Cloud-only params (customCategories, rerank, output_format) are never
 * sent. deleteAll requires admin — a 403 from the server surfaces as an
 * error (callers degrade gracefully).
 */
export interface SelfHostedMemoryClientOptions {
  /** Base URL of the self-hosted mem0 server, e.g. http://localhost:8890 */
  host: string;
  /** X-API-Key value (ADMIN_API_KEY or a per-user API key). */
  apiKey: string;
  /** Per-request timeout in ms (default 5000). Overridable for tests. */
  timeoutMs?: number;
}

export interface MemoryMessage {
  role: string;
  content: string;
}

/** Snake_case filters — the self-hosted API's wire format (D3). */
export interface MemoryFilters {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
}

export interface MemoryRow {
  id: string;
  memory: string;
  hash?: string;
  userId?: string;
  agentId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  categories?: string[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface AddOptions {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
  metadata?: Record<string, unknown>;
  infer?: boolean;
  /** Accepted for API compatibility but never sent to a self-hosted server. */
  customCategories?: unknown[];
}

export interface SearchOptions {
  filters?: MemoryFilters;
  threshold?: number;
  topK?: number;
}

export interface GetAllOptions {
  filters?: MemoryFilters;
  limit?: number;
}

export interface DeleteAllOptions {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
}

export interface UpdateOptions {
  text: string;
  metadata?: Record<string, unknown>;
}

interface SearchResponse {
  results: MemoryRow[];
  count?: number;
}

interface MessageResponse {
  message: string;
}

const SNAKE_TO_CAMEL: Record<string, string> = {
  user_id: 'userId',
  agent_id: 'agentId',
  run_id: 'runId',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  expiration_date: 'expirationDate',
  top_k: 'topK',
  custom_categories: 'customCategories',
};

function toCamel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toCamel);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[SNAKE_TO_CAMEL[k] ?? k] = toCamel(v);
    }
    return out;
  }
  return value;
}

function filtersToSnake(filters?: MemoryFilters): Record<string, string> | undefined {
  if (!filters) return undefined;
  const out: Record<string, string> = {};
  if (filters.user_id !== undefined) out.user_id = filters.user_id;
  if (filters.agent_id !== undefined) out.agent_id = filters.agent_id;
  if (filters.run_id !== undefined) out.run_id = filters.run_id;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Identity identifiers — passed through as-is (already snake_case wire format). */
function identityToSnake(opts: {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts.user_id !== undefined) out.user_id = opts.user_id;
  if (opts.agent_id !== undefined) out.agent_id = opts.agent_id;
  if (opts.run_id !== undefined) out.run_id = opts.run_id;
  return out;
}

export class SelfHostedMemoryClient {
  private readonly host: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: SelfHostedMemoryClientOptions) {
    this.host = options.host.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Time-bounded: a hung/half-open mem0 host must never stall a turn
    // (D10 — memory is best-effort). 5s is generous for a local server.
    const res = await fetch(`${this.host}${path}`, {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const parsed = (await res.json()) as { detail?: string; message?: string };
        detail = parsed.detail ?? parsed.message ?? '';
      } catch {
        /* non-JSON error body — keep generic message */
      }
      throw new Error(
        `mem0 request failed: ${method} ${path} → HTTP ${res.status}${detail ? `: ${detail}` : ''}`
      );
    }
    return (await res.json()) as T;
  }

  /**
   * Store messages; the server extracts and persists memories from them.
   * Identity (agent_id / run_id) is tagged on add for provenance (D3).
   */
  async add(
    messages: MemoryMessage[],
    options: AddOptions = {}
  ): Promise<{ results: MemoryRow[] }> {
    const body: Record<string, unknown> = {
      messages,
      ...identityToSnake(options),
    };
    if (options.metadata !== undefined) body.metadata = options.metadata;
    if (options.infer !== undefined) body.infer = options.infer;
    // customCategories is cloud-only — deliberately never sent (D5).
    const raw = await this.request<{ results: unknown[] }>('POST', '/memories', body);
    return { results: (raw.results ?? []).map((r) => toCamel(r) as MemoryRow) };
  }

  /**
   * Semantic recall. filters are scoped to the agent (D3): search does NOT
   * filter by run so memories persist across runs.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const body: Record<string, unknown> = { query };
    const filters = filtersToSnake(options.filters);
    if (filters) body.filters = filters;
    if (options.threshold !== undefined) body.threshold = options.threshold;
    if (options.topK !== undefined) body.top_k = options.topK;
    const raw = await this.request<{ results?: unknown[]; count?: number }>(
      'POST',
      '/search',
      body
    );
    return {
      results: (raw.results ?? []).map((r) => toCamel(r) as MemoryRow),
      ...(raw.count !== undefined ? { count: raw.count } : {}),
    };
  }

  /** List all memories in scope. GET + query params (D5 — not POST + body). */
  async getAll(options: GetAllOptions = {}): Promise<SearchResponse> {
    const params = new URLSearchParams();
    const ids = identityToSnake({ ...(options.filters ?? {}) });
    for (const [k, v] of Object.entries(ids)) params.set(k, v);
    if (options.limit !== undefined) params.set('top_k', String(options.limit));
    const qs = params.toString();
    const raw = await this.request<{ results?: unknown[]; count?: number }>(
      'GET',
      `/memories${qs ? `?${qs}` : ''}`
    );
    return {
      results: (raw.results ?? []).map((r) => toCamel(r) as MemoryRow),
      ...(raw.count !== undefined ? { count: raw.count } : {}),
    };
  }

  /** Replace a memory's text by id. */
  async update(memoryId: string, options: UpdateOptions): Promise<MessageResponse> {
    return this.request<MessageResponse>('PUT', `/memories/${encodeURIComponent(memoryId)}`, {
      text: options.text,
      ...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
    });
  }

  /** Delete a single memory by id. */
  async delete(memoryId: string): Promise<MessageResponse> {
    return this.request<MessageResponse>('DELETE', `/memories/${encodeURIComponent(memoryId)}`);
  }

  /** Wipe every memory in scope. Admin endpoint — 403 surfaces as an error. */
  async deleteAll(options: DeleteAllOptions = {}): Promise<MessageResponse> {
    const params = new URLSearchParams(identityToSnake(options));
    const qs = params.toString();
    return this.request<MessageResponse>('DELETE', `/memories${qs ? `?${qs}` : ''}`);
  }
}
