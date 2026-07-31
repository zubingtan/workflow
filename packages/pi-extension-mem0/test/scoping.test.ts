/**
 * F1b (#212 D3): scope mapping for self-hosted mem0.
 *
 * Upstream scopes (project/session/global) are replaced with:
 *   - "agent" (default): { agent_id } — all memories of this agent,
 *     shared across every workflow that references it (stories 3+4)
 *   - "session": { agent_id, run_id } — only the current run's memories
 *
 * user_id is intentionally never set (single-user local deployment);
 * app_id does not exist in self-hosted mem0 and is dropped entirely.
 */
import { describe, expect, it } from 'vitest';
import { resolveSearchFilters, resolveAddParams } from '../src/memory/scoping.ts';

const CTX = { agentId: 'agent-42', runId: 'run-abc123' };

describe('resolveSearchFilters (self-hosted scopes)', () => {
  it('agent scope filters by agent_id only — cross-run recall', () => {
    const filters = resolveSearchFilters('agent', { ...CTX, userId: 'u1', appId: 'ignored-app' });
    expect(filters).toEqual({ agent_id: 'agent-42' });
  });

  it('session scope adds run_id — current-run memories only', () => {
    const filters = resolveSearchFilters('session', CTX);
    expect(filters).toEqual({ agent_id: 'agent-42', run_id: 'run-abc123' });
  });

  it('never includes user_id or app_id (self-hosted has no app concept)', () => {
    for (const scope of ['agent', 'session'] as const) {
      const filters = resolveSearchFilters(scope, { ...CTX, userId: 'some-user' });
      expect(filters).not.toHaveProperty('user_id');
      expect(filters).not.toHaveProperty('app_id');
    }
  });
});

describe('resolveAddParams (self-hosted scopes)', () => {
  it('agent scope tags add with agent_id only', () => {
    expect(resolveAddParams('agent', CTX)).toEqual({ agent_id: 'agent-42' });
  });

  it('session scope tags add with agent_id + run_id (provenance, D3)', () => {
    expect(resolveAddParams('session', CTX)).toEqual({
      agent_id: 'agent-42',
      run_id: 'run-abc123',
    });
  });

  it('drops userId/appId even when present on the context', () => {
    const params = resolveAddParams('agent', { ...CTX, userId: 'u1', appId: 'app' });
    expect(params).not.toHaveProperty('userId');
    expect(params).not.toHaveProperty('appId');
  });
});
