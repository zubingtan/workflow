/**
 * Self-hosted scope mapping (#212 D3).
 *
 * Upstream's project/session/global (user_id + app_id based) is replaced by
 * agent/session:
 *   - agent:    { agent_id }             — cross-run recall within one agent
 *   - session:  { agent_id, run_id }     — this run only
 *
 * user_id is never sent (single-user local deployment; reserved for a future
 * multi-user path). app_id does not exist in self-hosted mem0 and is dropped
 * entirely — the cloud plugin's git-root-derived app_id is discarded.
 */
import type { Scope, ScopeContext } from '../types.ts';

export function resolveSearchFilters(scope: Scope, ctx: ScopeContext): Record<string, string> {
  switch (scope) {
    case 'agent':
      return { agent_id: ctx.agentId };
    case 'session':
      return { agent_id: ctx.agentId, run_id: ctx.runId };
  }
}

export function resolveAddParams(scope: Scope, ctx: ScopeContext): Record<string, string> {
  switch (scope) {
    case 'agent':
      return { agent_id: ctx.agentId };
    case 'session':
      return { agent_id: ctx.agentId, run_id: ctx.runId };
  }
}
