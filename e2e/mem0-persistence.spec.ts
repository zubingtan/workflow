/**
 * T6 (#219): E2E test — full memory persistence verification.
 *
 * Validates the complete mem0 integration chain:
 *   1. Agent run #1 with extractable facts → auto-capture stores memories
 *   2. Agent run #2 → context injection retrieves stored memories
 *
 * Requires:
 *   - MEM0_E2E=1 (global-setup starts mem0 + pgvector containers)
 *   - OPENAI_API_KEY + OPENAI_BASE_URL for mem0's internal LLM/embedding
 *
 * The test is SKIPPED when MEM0_E2E is not set, so the standard E2E suite
 * (pnpm test:e2e) runs unaffected.
 *
 * Idempotency: each run creates a fresh agent (unique nanoid), so no prior
 * memories exist. docker compose down -v in teardown wipes pgvector data.
 */
import { test, expect } from '@playwright/test';
import {
  createAgent,
  buildWorkflowSchema,
  createWorkflow,
  submitRun,
  waitForTerminal,
} from './helpers';

const MEM0_E2E = process.env.MEM0_E2E === '1';
const MEM0_E2E_PORT = process.env.MEM0_E2E_PORT ?? '8890';
const MEM0_BASE = `http://localhost:${MEM0_E2E_PORT}`;

// Polling helper: wait until mem0 API returns memories for the agent.
async function waitForMemories(
  agentId: string,
  opts: { timeoutMs?: number; minCount?: number } = {}
): Promise<any[]> {
  const { timeoutMs = 60_000, minCount = 1 } = opts;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${MEM0_BASE}/memories?agent_id=${encodeURIComponent(agentId)}`);
      if (res.ok) {
        const body = await res.json();
        const results = body.results ?? body;
        if (Array.isArray(results) && results.length >= minCount) return results;
      }
    } catch {
      // mem0 may not be ready yet; keep polling.
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`mem0 did not store memories for agent ${agentId} within ${timeoutMs}ms`);
}

// Search mem0 for memories relevant to a query.
async function searchMemories(agentId: string, query: string): Promise<any[]> {
  const res = await fetch(`${MEM0_BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      filters: { agent_id: agentId },
    }),
  });
  if (!res.ok) throw new Error(`mem0 search failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.results ?? body;
}

test.describe('mem0 memory persistence (T6 #219)', () => {
  test.skip(!MEM0_E2E, 'MEM0_E2E not set — skipping memory persistence test');

  // Extended timeout: mem0 auto-capture involves LLM extraction (can be slow).
  test.setTimeout(180_000);

  test('auto-capture stores memories and search retrieves them across runs', async () => {
    // --- Setup: create agent + workflow ---
    const agentId = await createAgent();
    const fact = `My name is Alice_${Date.now()} and my favorite language is Python`;
    const schema = buildWorkflowSchema(agentId, fact);
    const workflowId = await createWorkflow(`mem0-e2e-${Date.now()}`, schema);

    // --- Run #1: deliver extractable facts ---
    const runId1 = await submitRun(workflowId, schema);
    const run1 = await waitForTerminal(runId1, 60_000);
    expect(run1.status).toBe('succeeded');

    // --- Verify auto-capture: poll mem0 until memories appear ---
    const memories = await waitForMemories(agentId, { timeoutMs: 90_000, minCount: 1 });
    expect(memories.length).toBeGreaterThanOrEqual(1);

    // At least one memory should reference the content we delivered.
    const allText = memories
      .map((m: any) => m.memory ?? m.text ?? '')
      .join(' ')
      .toLowerCase();
    // mem0's LLM extracts semantic facts — check for key concepts, not exact text.
    expect(allText).toMatch(/alice|name|python|language|favorite/);

    // --- Semantic search: verify retrieval works ---
    const searchResults = await searchMemories(agentId, 'What is the user name?');
    expect(searchResults.length).toBeGreaterThanOrEqual(1);
    const searchText = searchResults
      .map((m: any) => m.memory ?? m.text ?? '')
      .join(' ')
      .toLowerCase();
    expect(searchText).toMatch(/alice|name/);

    // --- Run #2: context injection exercises search path ---
    // The fake provider returns a canned response regardless of system prompt,
    // so we can't verify the output text. But a successful run #2 proves:
    //   - before_agent_start fired (context injection searched mem0)
    //   - No errors in the extension lifecycle
    //   - The full createSession → bindExtensions → prompt → terminal path works
    //     with memories already present (no regression from stored state).
    const recallPrompt = 'What is my name and favorite language?';
    const schema2 = buildWorkflowSchema(agentId, recallPrompt);
    const runId2 = await submitRun(workflowId, schema2);
    const run2 = await waitForTerminal(runId2, 60_000);
    expect(run2.status).toBe('succeeded');

    // --- Verify no duplicate explosion: memory count is bounded ---
    // After two runs, auto-capture may extract from run #2's conversation too,
    // but should not create unbounded duplicates (mem0 deduplicates internally).
    const finalMemories = await waitForMemories(agentId, { timeoutMs: 10_000, minCount: 1 });
    // Sanity: not more than 10 memories from 2 short conversations.
    expect(finalMemories.length).toBeLessThanOrEqual(10);
  });
});
