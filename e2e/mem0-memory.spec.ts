import { expect, test } from '@playwright/test';
import {
  createAgent,
  buildWorkflowSchema,
  createWorkflow,
  submitRun,
  waitForTerminal,
} from './helpers';

/**
 * mem0 persistent memory E2E suite (#212 seam 3).
 *
 * Full loop against a FAKE self-hosted mem0 server (port 8890, spawned by
 * global-setup — isolated from any local mem0 instance, user story 11):
 *
 *   1. Auto-capture (D6): Run #1 tells the agent a fact; after the run, the
 *      extension's agent_end hook POSTs the conversation to /memories with
 *      X-API-Key + agent_id + run_id.
 *   2. Context injection / recall (D7): Run #2 asks about the fact; the
 *      extension's before_agent_start hook POSTs /search scoped to the agent,
 *      and the matched memory lands in the system prompt. The fake provider
 *      echoes "Agent A output" when the system prompt contains "Use Skill A."
 *      — so the run's output proves the memory was recalled and injected.
 *   3. Cross-workflow sharing (story 4): the same agent referenced from a
 *      second workflow still recalls the memory.
 *   4. Graceful degradation (D10, story 8): pointing mem0 at an unreachable
 *      host must NOT fail the run.
 *   5. Agent isolation (story 3): agent B never sees agent A's memories.
 */

const MEM0_BASE = 'http://localhost:8890';
const MEM0_KEY = 'e2e-mem0-key';
const SERVER_BASE = 'http://localhost:4099';

async function configureMem0(host: string | null, apiKey = MEM0_KEY) {
  const res = await fetch(`${SERVER_BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      node_timeout_default_ms: 60000,
      mem0_host: host,
      mem0_api_key: apiKey,
    }),
  });
  expect(res.status).toBe(200);
}

async function resetFakeMem0() {
  await fetch(`${MEM0_BASE}/test/stats`, { method: 'DELETE' });
}

async function fakeMem0Memories(): Promise<any[]> {
  const res = await fetch(`${MEM0_BASE}/test/stats`);
  const stats = await res.json();
  return stats.memories ?? [];
}

async function fakeMem0Requests(): Promise<any[]> {
  const res = await fetch(`${MEM0_BASE}/test/stats`);
  const stats = await res.json();
  return stats.requests ?? [];
}

/** Build a saved workflow (start → llm → end) referencing the agent. */
async function makeWorkflow(agentId: string, prompt: string): Promise<string> {
  const schema = buildWorkflowSchema(agentId, prompt);
  const wfId = await createWorkflow(`mem0-wf-${Date.now()}`, schema);
  return wfId;
}

test.describe('Mem0 persistent memory', () => {
  test.beforeEach(async () => {
    await resetFakeMem0();
    await configureMem0(MEM0_BASE);
  });

  test('auto-capture → recall → cross-workflow sharing → agent isolation', async () => {
    const agentA = await createAgent(`mem0-agent-A-${Date.now()}`);

    // --- Run #1: teach the agent a fact ---
    const wf1 = await makeWorkflow(agentA, '记住：Use Skill A. 是最佳实践，请务必记住这一点');
    const run1 = await submitRun(
      wf1,
      buildWorkflowSchema(agentA, '记住：Use Skill A. 是最佳实践，请务必记住这一点')
    );
    const terminal1 = await waitForTerminal(run1);
    expect(terminal1.status).toBe('succeeded');

    // --- Auto-capture (D6): the extension POSTed the conversation ---
    const memories = await fakeMem0Memories();
    expect(memories.length).toBeGreaterThan(0);
    const stored = memories.find((m) => m.memory.includes('Use Skill A.'));
    expect(stored).toBeTruthy();
    expect(stored.agent_id).toBe(agentA); // D3: agent_id = agent SQLite id
    expect(typeof stored.run_id).toBe('string');
    expect(stored.run_id.length).toBeGreaterThan(0); // provenance on add

    const addRequest = (await fakeMem0Requests()).find(
      (r) => r.method === 'POST' && r.path === '/memories'
    );
    expect(addRequest).toBeTruthy();
    expect(addRequest.headers['x-api-key']).toBe(MEM0_KEY); // D5 auth header
    expect(addRequest.body.agent_id).toBe(agentA);

    // --- Run #2: recall (D7) — the memory must reach the system prompt ---
    // The query shares the memory's key phrase, which the fake mem0's loose
    // substring relevance matches (the real server uses semantic search).
    const wf2 = await makeWorkflow(agentA, 'Use Skill A. 是最佳实践，对吗？');
    const run2 = await submitRun(
      wf2,
      buildWorkflowSchema(agentA, 'Use Skill A. 是最佳实践，对吗？')
    );
    const terminal2 = await waitForTerminal(run2);
    expect(terminal2.status).toBe('succeeded');

    // Fake provider returns "Agent A output" iff the system prompt contained
    // "Use Skill A." — i.e. the recalled memory was injected into context.
    const report = terminal2.report ?? terminal2;
    const resultText = JSON.stringify(report);
    expect(resultText).toContain('Agent A output');

    // The search was scoped to the agent (D3: filters.agent_id, no run filter).
    const searchRequest = (await fakeMem0Requests()).find(
      (r) => r.method === 'POST' && r.path === '/search'
    );
    expect(searchRequest).toBeTruthy();
    expect(searchRequest.body.filters.agent_id).toBe(agentA);
    expect(searchRequest.body.filters.run_id).toBeUndefined();

    // --- Cross-workflow sharing (story 4): a different workflow, same agent ---
    const wf3 = await makeWorkflow(agentA, 'Use Skill A. 是最佳实践，再说一次');
    const run3 = await submitRun(
      wf3,
      buildWorkflowSchema(agentA, 'Use Skill A. 是最佳实践，再说一次')
    );
    const terminal3 = await waitForTerminal(run3);
    expect(terminal3.status).toBe('succeeded');
    expect(JSON.stringify(terminal3.report ?? terminal3)).toContain('Agent A output');

    // --- Agent isolation (story 3): agent B never sees agent A's memories ---
    const agentB = await createAgent(`mem0-agent-B-${Date.now()}`);
    const wfB = await makeWorkflow(agentB, 'Use Skill A. 是什么？');
    const runB = await submitRun(wfB, buildWorkflowSchema(agentB, 'Use Skill A. 是什么？'));
    const terminalB = await waitForTerminal(runB);
    expect(terminalB.status).toBe('succeeded');
    // No memory match for agent B → no injection → fake provider's default reply.
    expect(JSON.stringify(terminalB.report ?? terminalB)).toContain('Fake provider response');
  });

  test('graceful degradation: unreachable mem0 host does not fail the run (D10)', async () => {
    const agent = await createAgent(`mem0-degraded-${Date.now()}`);

    // Point mem0 at a dead port.
    await configureMem0('http://localhost:19999');

    const wf = await makeWorkflow(agent, 'Say hello');
    const run = await submitRun(wf, buildWorkflowSchema(agent, 'Say hello'));
    const terminal = await waitForTerminal(run);
    expect(terminal.status).toBe('succeeded');
  });
});
