import type {
  AddOptions,
  AddResponse,
  DeleteAllOptions,
  DeleteResponse,
  GetAllOptions,
  GetAllResponse,
  Memory,
  MemoryClientLike,
  Message,
  SearchOptions,
  SearchResponse,
  UpdateResponse,
} from './types.js';

export interface SelfHostedClientOptions {
  /** Base URL of the mem0 self-hosted server, e.g. "http://localhost:8888" */
  host: string;
  /** API key sent as X-API-Key header (use ADMIN_API_KEY for deleteAll). */
  apiKey: string;
  /** Request timeout in milliseconds. Default: 60_000 */
  timeout?: number;
}

/** Error thrown when the mem0 server returns a non-OK response. */
export class Mem0ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body: unknown
  ) {
    super(`mem0 API error: ${status} ${statusText}`);
    this.name = 'Mem0ApiError';
  }
}

/**
 * Convert a snake_case string to camelCase.
 * e.g. "created_at" → "createdAt", "memory_id" → "memoryId"
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Recursively convert all object keys from snake_case to camelCase.
 * Arrays are mapped element-wise; primitives pass through.
 */
function snakeToCamelKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => snakeToCamelKeys(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[snakeToCamel(key)] = snakeToCamelKeys(val);
    }
    return result as T;
  }
  return value;
}

/**
 * HTTP client for the mem0 self-hosted server.
 *
 * Key differences from the cloud MemoryClient:
 * - No /v1/ or /v3/ URL prefixes
 * - Auth via X-API-Key header (not Authorization: Token)
 * - getAll uses GET + query params (not POST + body)
 * - Responses are snake_case and converted to camelCase here
 */
export class SelfHostedMemoryClient implements MemoryClientLike {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number;

  constructor(options: SelfHostedClientOptions) {
    // Strip trailing slash to avoid double-slash in URLs.
    this.baseUrl = options.host.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeout = options.timeout ?? 60_000;
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    const body: Record<string, unknown> = { query };
    if (options?.filters) body.filters = options.filters;
    if (options?.topK !== undefined) body.top_k = options.topK;
    if (options?.threshold !== undefined) body.threshold = options.threshold;
    return this.post<SearchResponse>('/search', body);
  }

  async add(messages: Message[], options?: AddOptions): Promise<AddResponse> {
    const body: Record<string, unknown> = { messages };
    if (options?.userId) body.user_id = options.userId;
    if (options?.agentId) body.agent_id = options.agentId;
    if (options?.runId) body.run_id = options.runId;
    if (options?.infer !== undefined) body.infer = options.infer;
    return this.post<AddResponse>('/memories', body);
  }

  async getAll(options?: GetAllOptions): Promise<GetAllResponse> {
    const params = new URLSearchParams();
    if (options?.filters?.user_id) params.set('user_id', options.filters.user_id);
    if (options?.filters?.agent_id) params.set('agent_id', options.filters.agent_id);
    if (options?.filters?.run_id) params.set('run_id', options.filters.run_id);
    const qs = params.toString();
    return this.get<GetAllResponse>(`/memories${qs ? `?${qs}` : ''}`);
  }

  async update(memoryId: string, body: { text: string }): Promise<UpdateResponse> {
    return this.put<UpdateResponse>(`/memories/${encodeURIComponent(memoryId)}`, body);
  }

  async delete(memoryId: string): Promise<DeleteResponse> {
    return this.del<DeleteResponse>(`/memories/${encodeURIComponent(memoryId)}`);
  }

  async deleteAll(options?: DeleteAllOptions): Promise<DeleteResponse> {
    const params = new URLSearchParams();
    if (options?.userId) params.set('user_id', options.userId);
    if (options?.agentId) params.set('agent_id', options.agentId);
    const qs = params.toString();
    return this.del<DeleteResponse>(`/memories${qs ? `?${qs}` : ''}`);
  }

  // ─── Private HTTP helpers ────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        let errorBody: unknown;
        try {
          errorBody = await res.json();
        } catch {
          errorBody = await res.text().catch(() => '');
        }
        throw new Mem0ApiError(res.status, res.statusText, errorBody);
      }

      const json = await res.json();
      return snakeToCamelKeys(json) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  private del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
