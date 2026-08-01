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
