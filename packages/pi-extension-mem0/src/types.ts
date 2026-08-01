// ─── Client types ────────────────────────────────────────────────────────────

/** A single memory record returned by the mem0 self-hosted server. */
export interface Memory {
  id: string;
  memory: string;
  userId?: string;
  agentId?: string;
  runId?: string;
  hash?: string;
  createdAt?: string;
  updatedAt?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

/** Message in the conversation format expected by mem0 add(). */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Filters for scoping memory queries. */
export interface MemoryFilters {
  user_id?: string;
  agent_id?: string;
  run_id?: string;
}

export interface SearchOptions {
  filters?: MemoryFilters;
  topK?: number;
  threshold?: number;
}

export interface AddOptions {
  userId?: string;
  agentId?: string;
  runId?: string;
  infer?: boolean;
}

export interface GetAllOptions {
  filters?: MemoryFilters;
}

export interface DeleteAllOptions {
  userId?: string;
  agentId?: string;
}

export interface SearchResponse {
  results: Memory[];
}

export interface GetAllResponse {
  results: Memory[];
  count?: number;
}

export interface AddResponse {
  results: Array<{
    id: string;
    memory: string;
    event: string;
  }>;
}

export interface UpdateResponse {
  id: string;
  memory: string;
  event: string;
}

export interface DeleteResponse {
  message: string;
}

/** The interface that both cloud MemoryClient and SelfHostedMemoryClient satisfy. */
export interface MemoryClientLike {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  add(messages: Message[], options?: AddOptions): Promise<AddResponse>;
  getAll(options?: GetAllOptions): Promise<GetAllResponse>;
  update(memoryId: string, body: { text: string }): Promise<UpdateResponse>;
  delete(memoryId: string): Promise<DeleteResponse>;
  deleteAll(options?: DeleteAllOptions): Promise<DeleteResponse>;
}

// ─── Extension types ─────────────────────────────────────────────────────────

/** Memory scope levels for self-hosted deployment. */
export type Scope = 'agent' | 'session';

/** Runtime scope context resolved during session lifecycle. */
export interface ScopeContext {
  agentId: string;
  runId: string;
}

export interface DreamConfig {
  enabled: boolean;
  auto: boolean;
  minHours: number;
  minSessions: number;
  minMemories: number;
}

export interface DreamState {
  lastConsolidatedAt: number;
  sessionsSince: number;
  lastSessionId: string | null;
}

export interface DreamLock {
  pid: number;
  startedAt: number;
}

/** Extension configuration loaded from mem0-config.json. */
export interface Mem0ExtensionConfig {
  /** Self-hosted mem0 server base URL. */
  host: string;
  /** API key for the self-hosted mem0 server. */
  apiKey: string;
  /** Agent identifier used for memory scoping. */
  agentId: string;
  /** Enable auto-capture of conversations on agent_end. */
  autoCapture: boolean;
  /** Default scope for memory operations. */
  defaultScope: Scope;
  /** Inject relevant memories into system prompt before each turn. */
  contextInjection: boolean;
  /** Minimum similarity score for search results. */
  searchThreshold: number;
  /** Dream (memory consolidation) configuration. */
  dream: DreamConfig;
}
