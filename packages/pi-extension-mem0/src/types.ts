/**
 * Self-hosted adaptation (#212 D3): scopes collapse from upstream's
 * project/session/global to agent/session:
 *   - "agent" (default): { agent_id } — every memory of this agent,
 *     shared across all workflows that reference it (stories 3+4)
 *   - "session": { agent_id, run_id } — only this run's memories
 */
export type Scope = 'agent' | 'session';

export interface DreamConfig {
  enabled: boolean;
  auto: boolean;
  minHours: number;
  minSessions: number;
  minMemories: number;
}

export interface Mem0Config {
  /** Self-hosted wire format (no /v1/ prefix, X-API-Key auth). Default true. */
  selfHosted: boolean;
  /** Self-hosted mem0 server base URL, e.g. http://mem0:8000 */
  host: string;
  /** X-API-Key value (ADMIN_API_KEY or a per-user API key). */
  apiKey: string;
  /** Workflow Agent SQLite id — the core isolation dimension (D3). */
  agentId: string;
  /** Workflow runID (nanoid(12), queue-assigned) — provenance on add (D3). */
  runId: string;
  /** Not set yet (single-user local deployment); reserved for multi-user. */
  userId: string;
  autoCapture: boolean;
  defaultScope: Scope;
  contextInjection: boolean;
  searchThreshold: number;
  dream: DreamConfig;
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

export interface ScopeContext {
  /** Workflow Agent SQLite id — primary isolation dimension (D3). */
  agentId: string;
  /** Workflow runID — set on add for provenance; session scope filters by it. */
  runId: string;
  /** Reserved for multi-user; never set in the single-user deployment. */
  userId?: string;
}

export interface CustomCategory {
  [key: string]: string;
}

/**
 * The client surface the tool/commands/capture layers depend on. In this
 * fork it is implemented by SelfHostedMemoryClient (self-hosted wire format);
 * defined here so those layers never import the client module directly
 * (mirrors upstream's `import type MemoryClient from "mem0ai"` seam).
 */
export interface MemoryLike {
  id: string;
  memory?: string;
  categories?: string[];
  createdAt?: Date | string;
  [key: string]: unknown;
}

export interface MemoryClientLike {
  add(
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>
  ): Promise<{ results?: unknown[] }>;
  search(
    query: string,
    options?: { filters?: Record<string, string>; threshold?: number; topK?: number }
  ): Promise<{ results?: MemoryLike[]; count?: number }>;
  getAll(options?: {
    filters?: Record<string, string>;
    limit?: number;
  }): Promise<{ results?: MemoryLike[]; count?: number }>;
  update(memoryId: string, options: { text: string }): Promise<{ message?: string }>;
  delete(memoryId: string): Promise<{ message?: string }>;
  deleteAll(options?: Record<string, string>): Promise<{ message?: string }>;
}

export const DEFAULT_CUSTOM_CATEGORIES: CustomCategory[] = [
  { identity: 'Personal details, background, and self-descriptions' },
  { preferences: 'Likes, dislikes, habits, and preferred ways of doing things' },
  { goals: 'Objectives, aspirations, and targets the user is working toward' },
  { projects: 'Ongoing work, initiatives, and areas of focus' },
  { decisions: 'Choices made, rationale, and trade-offs considered' },
  { technical: 'Technical knowledge, tools, configurations, and environment details' },
  { relationships: 'People, teams, organizations, and their roles' },
  { routines: 'Recurring patterns, workflows, schedules, and processes' },
  { lessons: 'Insights learned, mistakes to avoid, and best practices discovered' },
  { work: 'Professional context, role, responsibilities, and work environment' },
];
