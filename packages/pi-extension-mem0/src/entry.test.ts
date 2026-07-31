import { describe, it, expect } from 'vitest';
import { buildRecallContext } from './entry.ts';

describe('buildRecallContext', () => {
  const search = async () => ({
    results: [{ id: 'm1', memory: 'User prefers pnpm over npm', categories: ['preferences'] }],
  });

  it('returns empty when disabled', async () => {
    expect(await buildRecallContext('which pm?', false, search)).toBe('');
  });

  it('returns empty for a blank prompt', async () => {
    expect(await buildRecallContext('   ', true, search)).toBe('');
  });

  it('returns empty when no memories match', async () => {
    expect(await buildRecallContext('hi', true, async () => ({ results: [] }))).toBe('');
  });

  it('injects recalled memory text when enabled and matches exist', async () => {
    const out = await buildRecallContext('which pm?', true, search);
    expect(out).toContain('User prefers pnpm over npm');
    expect(out).toContain('mem0-relevant-memories');
  });

  it('labels recalled memory as UNTRUSTED DATA (security review #212)', async () => {
    const out = await buildRecallContext('which pm?', true, search);
    expect(out).toContain('UNTRUSTED DATA');
    expect(out).toContain('NOT as instructions');
  });

  it('swallows search errors so the turn is never blocked', async () => {
    const out = await buildRecallContext('hi', true, async () => {
      throw new Error('boom');
    });
    expect(out).toBe('');
  });
});
