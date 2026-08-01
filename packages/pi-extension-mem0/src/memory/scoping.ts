import * as crypto from 'node:crypto';
import type { MemoryFilters, AddOptions, Scope, ScopeContext } from '../types.js';

/**
 * Derive a stable run ID from the session file path.
 * Falls back to "unknown" when no session file is available.
 */
export function detectRunId(sessionFile: string | undefined): string {
  if (!sessionFile) return 'unknown';
  return crypto.createHash('sha256').update(sessionFile).digest('hex').slice(0, 12);
}

/**
 * Resolve search filters for the given scope.
 *
 * - agent:   { agent_id }
 * - session: { agent_id, run_id }
 */
export function resolveSearchFilters(scope: Scope, ctx: ScopeContext): MemoryFilters {
  switch (scope) {
    case 'agent':
      return { agent_id: ctx.agentId };
    case 'session':
      return { agent_id: ctx.agentId, run_id: ctx.runId };
  }
}

/**
 * Resolve add/deleteAll params for the given scope.
 *
 * - agent:   { agentId }
 * - session: { agentId, runId }
 */
export function resolveAddParams(
  scope: Scope,
  ctx: ScopeContext
): Pick<AddOptions, 'agentId' | 'runId'> {
  switch (scope) {
    case 'agent':
      return { agentId: ctx.agentId };
    case 'session':
      return { agentId: ctx.agentId, runId: ctx.runId };
  }
}
