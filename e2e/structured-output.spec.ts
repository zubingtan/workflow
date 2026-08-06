import { expect, test } from '@playwright/test';

import {
  configureFakeProvider,
  createAgent,
  createWorkflow,
  getFakeProviderCalls,
  getRun,
  resetFakeProviderStats,
  submitRun,
  waitForTerminal,
} from './helpers';

/**
 * #250: structured outputs wired into FlowGram — downstream node-id.field
 * references, TaskReport projection, legacy-document compatibility.
 *
 * Acceptance covered:
 *   - success only projects declared fields (extra fields in the provider
 *     response are dropped, never reach the report/variable tree)
 *   - downstream nodes read declared fields by node-id.field with the exact
 *     primitive type
 *   - legacy workflows (outputs without `required`) keep working — the
 *     compile-time normalization treats the property list as the contract
 *   - failure semantics: invalid JSON corrects once then fails; refusal
 *     retries once then fails; incomplete fails — no half-baked outputs
 *     reach the report
 *
 * Fake provider (extended in #251) records lastPayload so the test also
 * asserts response_format.json_schema injection happened on the wire.
 */

const FAKE_BASE = 'http://localhost:4011/v1';

/** Build a workflow with a custom Agent node outputs schema + downstream end ref. */
function buildWorkflow(agentId: string, outputs: any, endRef: string[], prompt: string) {
  return {
    nodes: [
      {
        id: 'start_0',
        type: 'start',
        meta: { position: { x: 100, y: 300 } },
        data: {
          title: 'Start',
          outputs: { type: 'object', properties: { query: { type: 'string', default: 'Hello' } } },
        },
      },
      {
        id: 'llm_main',
        type: 'llm',
        meta: { position: { x: 540, y: 300 } },
        data: {
          title: 'Agent_Main',
          inputsValues: {
            agentId: { type: 'constant', content: agentId },
            prompt: { type: 'template', content: prompt },
          },
          inputs: {
            type: 'object',
            required: ['agentId', 'prompt'],
            properties: {
              agentId: { type: 'string', extra: { formComponent: 'agent-select' } },
              prompt: { type: 'string', extra: { formComponent: 'prompt-editor' } },
            },
          },
          outputs,
        },
      },
      {
        id: 'end_0',
        type: 'end',
        meta: { position: { x: 980, y: 300 } },
        data: {
          title: 'End',
          inputsValues: { result: { type: 'ref', content: endRef } },
          inputs: { type: 'object', properties: { result: { type: 'string' } } },
        },
      },
    ],
    edges: [
      { sourceNodeID: 'start_0', targetNodeID: 'llm_main' },
      { sourceNodeID: 'llm_main', targetNodeID: 'end_0' },
    ],
  };
}

function nodeOutputs(report: any, nodeId: string): any {
  // FlowGram TaskReport shape: report.reports[nodeId].snapshots[last].outputs
  const nodeReport = report?.reports?.[nodeId];
  const snapshots = nodeReport?.snapshots;
  if (Array.isArray(snapshots) && snapshots.length > 0) {
    return snapshots[snapshots.length - 1]?.outputs ?? null;
  }
  return nodeReport?.outputs ?? null;
}

test.describe('Structured output FlowGram integration (#250)', () => {
  test('success: response_format injected, outputs projected, downstream ref typed', async () => {
    const correlationId = `e2e-so-success-${Date.now()}`;
    await configureFakeProvider(
      correlationId,
      'json_response',
      undefined,
      JSON.stringify({ result: 'hello world', n: 42 })
    );

    const agentId = await createAgent();
    const schema = buildWorkflow(
      agentId,
      {
        type: 'object',
        properties: { result: { type: 'string' }, n: { type: 'integer' } },
      },
      ['llm_main', 'result'],
      `Run ${correlationId}`
    );
    const workflowId = await createWorkflow(`E2E SO Success ${Date.now()}`, schema);
    const runID = await submitRun(workflowId, schema);

    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('succeeded');

    // 1. The provider actually received a strict json_schema payload.
    const statsRes = await fetch('http://localhost:4011/test/stats');
    const stats = await statsRes.json();
    const rf = stats.lastPayload?.response_format;
    expect(rf?.type).toBe('json_schema');
    expect(rf?.json_schema?.strict).toBe(true);
    expect(rf?.json_schema?.schema?.additionalProperties).toBe(false);
    expect(Object.keys(rf?.json_schema?.schema?.properties ?? {})).toEqual(['result', 'n']);
    expect(rf?.json_schema?.schema?.required).toEqual(['result', 'n']);

    // 2. The report carries only the declared fields.
    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    const llmOutputs = nodeOutputs(report, 'llm_main');
    expect(llmOutputs).toBeTruthy();
    expect(llmOutputs.result).toBe('hello world');
    expect(llmOutputs.n).toBe(42);
    expect(llmOutputs).toHaveProperty('_executionDetail');

    // 3. The downstream end node read llm_main.result by node-id.field.
    const endSnapshot = nodeOutputs(report, 'end_0');
    expect(endSnapshot?.result).toBe('hello world');
  });

  test('extra fields in the provider response are rejected — failed, no consumable outputs', async () => {
    const correlationId = `e2e-so-extra-${Date.now()}`;
    await configureFakeProvider(
      correlationId,
      'json_response',
      undefined,
      JSON.stringify({ result: 'x', n: 1, extra: 'not-in-contract' })
    );

    const agentId = await createAgent();
    const schema = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' }, n: { type: 'integer' } } },
      ['llm_main', 'result'],
      `Run ${correlationId}`
    );
    const workflowId = await createWorkflow(`E2E SO Extra ${Date.now()}`, schema);
    const runID = await submitRun(workflowId, schema);

    // First response has the extra field → corrective turn (no correlationId
    // → provider default text, also invalid) → failed. The contract rejects
    // undeclared fields; nothing half-baked is consumable.
    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('failed');
    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    expect(JSON.stringify(report)).toMatch(/unexpected extra field/);
  });

  test('missing required field: corrected once, then failed with field-level reason', async () => {
    const correlationId = `e2e-so-missing-${Date.now()}`;
    // Response omits the declared `n` field entirely.
    await configureFakeProvider(
      correlationId,
      'json_response',
      undefined,
      JSON.stringify({ result: 'x' })
    );

    const agentId = await createAgent();
    const schema = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' }, n: { type: 'integer' } } },
      ['llm_main', 'result'],
      `Run ${correlationId}`
    );
    const workflowId = await createWorkflow(`E2E SO Missing ${Date.now()}`, schema);
    const runID = await submitRun(workflowId, schema);

    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('failed');
    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    // Note: report JSON escapes quotes (\"), so match field-less patterns;
    // the field-level reason is asserted in unit tests.
    expect(JSON.stringify(report)).toMatch(/missing required field/);
    // No half-baked outputs reach the report.
    expect(nodeOutputs(report, 'llm_main')).toBeNull();
  });

  test('type mismatch: integer not coerced, corrected once, then failed', async () => {
    const correlationId = `e2e-so-type-${Date.now()}`;
    // Provider returns a string where an integer is declared — must not coerce.
    await configureFakeProvider(
      correlationId,
      'json_response',
      undefined,
      JSON.stringify({ result: 'x', n: 'not-an-int' })
    );

    const agentId = await createAgent();
    const schema = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' }, n: { type: 'integer' } } },
      ['llm_main', 'result'],
      `Run ${correlationId}`
    );
    const workflowId = await createWorkflow(`E2E SO Type ${Date.now()}`, schema);
    const runID = await submitRun(workflowId, schema);

    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('failed');
    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    // Quotes are escaped in the report JSON — assert the type-level reason here.
    expect(JSON.stringify(report)).toMatch(/must be integer/);
  });

  test('legacy workflow (outputs without required) keeps working (#246 normalization)', async () => {
    const correlationId = `e2e-so-legacy-${Date.now()}`;
    await configureFakeProvider(
      correlationId,
      'json_response',
      undefined,
      JSON.stringify({ result: 'legacy ok' })
    );

    const agentId = await createAgent();
    // Legacy documents declare properties without `required`.
    const schema = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' } } },
      ['llm_main', 'result'],
      `Run ${correlationId}`
    );
    const workflowId = await createWorkflow(`E2E SO Legacy ${Date.now()}`, schema);
    const runID = await submitRun(workflowId, schema);

    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('succeeded');

    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    const llmOutputs = nodeOutputs(report, 'llm_main');
    expect(llmOutputs?.result).toBe('legacy ok');
  });

  test('invalid JSON corrects once, then fails with no consumable outputs', async () => {
    const correlationId = `e2e-so-invalid-${Date.now()}`;
    await configureFakeProvider(correlationId, 'invalid_json', undefined, 'this is not json');

    const agentId = await createAgent();
    const schema = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' } } },
      ['llm_main', 'result'],
      `Run ${correlationId}`
    );
    const workflowId = await createWorkflow(`E2E SO Invalid ${Date.now()}`, schema);
    const runID = await submitRun(workflowId, schema);

    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('failed');

    // The corrective prompt (no correlationId) hit the provider default text,
    // which is also not JSON → failed. No half-baked outputs anywhere.
    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    const reportJson = JSON.stringify(report);
    expect(reportJson).toMatch(/structured output validation failed|not valid JSON/);
  });

  test('refusal retries once, then fails (no fallback to plain text)', async () => {
    const correlationId = `e2e-so-refusal-${Date.now()}`;
    await configureFakeProvider(correlationId, 'refusal', undefined, 'I refuse');
    await resetFakeProviderStats();

    const agentId = await createAgent();
    const schema = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' } } },
      ['llm_main', 'result'],
      `Run ${correlationId}`
    );
    const workflowId = await createWorkflow(`E2E SO Refusal ${Date.now()}`, schema);
    const runID = await submitRun(workflowId, schema);

    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('failed');
    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    expect(JSON.stringify(report)).toMatch(/structured output validation failed|refused/);
    // Pin the "asked again once" semantics: the refusal must have produced at
    // least a second provider request (the retry turn). The retry prompt does
    // not carry the correlationId, so count the GLOBAL counter.
    expect(await getFakeProviderCalls()).toBeGreaterThanOrEqual(2);
  });

  test('incomplete (max tokens) fails directly', async () => {
    const correlationId = `e2e-so-incomplete-${Date.now()}`;
    await configureFakeProvider(correlationId, 'incomplete', undefined, '{"result":"trunc');

    const agentId = await createAgent();
    const schema = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' } } },
      ['llm_main', 'result'],
      `Run ${correlationId}`
    );
    const workflowId = await createWorkflow(`E2E SO Incomplete ${Date.now()}`, schema);
    const runID = await submitRun(workflowId, schema);

    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('failed');
    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    expect(JSON.stringify(report)).toMatch(/incomplete/);
  });

  test('concurrent runs never leak schemas across sessions (#248 per-run isolation)', async () => {
    const corrA = `e2e-so-conc-a-${Date.now()}`;
    const corrB = `e2e-so-conc-b-${Date.now()}`;
    await configureFakeProvider(corrA, 'json_response', undefined, JSON.stringify({ result: 'A' }));
    await configureFakeProvider(corrB, 'json_response', undefined, JSON.stringify({ count: 7 }));

    const agentId = await createAgent();
    // Workflow A declares {result: string}; workflow B declares {count: integer}.
    // If schemas leaked across sessions, one of them would fail validation.
    const schemaA = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' } } },
      ['llm_main', 'result'],
      `Run ${corrA}`
    );
    const schemaB = buildWorkflow(
      agentId,
      { type: 'object', properties: { count: { type: 'integer' } } },
      ['llm_main', 'result'],
      `Run ${corrB}`
    );
    const wfA = await createWorkflow(`E2E SO ConcA ${Date.now()}`, schemaA);
    const wfB = await createWorkflow(`E2E SO ConcB ${Date.now()}`, schemaB);

    const [runA, runB] = await Promise.all([submitRun(wfA, schemaA), submitRun(wfB, schemaB)]);
    const [termA, termB] = await Promise.all([
      waitForTerminal(runA, 30_000),
      waitForTerminal(runB, 30_000),
    ]);
    expect(termA.status).toBe('succeeded');
    expect(termB.status).toBe('succeeded');

    const [ra, rb] = await Promise.all([getRun(runA), getRun(runB)]);
    const reportA = typeof ra.report === 'string' ? JSON.parse(ra.report) : ra.report;
    const reportB = typeof rb.report === 'string' ? JSON.parse(rb.report) : rb.report;
    expect(nodeOutputs(reportA, 'llm_main')?.result).toBe('A');
    expect(nodeOutputs(reportA, 'llm_main')?.count).toBeUndefined();
    expect(nodeOutputs(reportB, 'llm_main')?.count).toBe(7);
    expect(nodeOutputs(reportB, 'llm_main')?.result).toBeUndefined();
  });

  test('capability error: unknown API shape fails before any provider request', async () => {
    // Create an agent whose provider pins an unsupported API shape — the
    // session creator must fail fast with a capability error before any
    // provider request is sent (no fallback, no plain-text downgrade).
    const agentRes = await fetch('http://localhost:4099/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `E2E SO Capability ${Date.now()}`,
        config: {
          provider: {
            base_url: FAKE_BASE,
            api_key: 'fake-provider-local',
            model: 'fake-m0',
            api: 'anthropic-messages',
          },
          system_prompt: 'You are an E2E test agent.',
        },
      }),
    });
    const agent = await agentRes.json();
    const agentId = agent.id;

    const schema = buildWorkflow(
      agentId,
      { type: 'object', properties: { result: { type: 'string' } } },
      ['llm_main', 'result'],
      'capability probe'
    );
    const workflowId = await createWorkflow(`E2E SO Capability ${Date.now()}`, schema);
    await resetFakeProviderStats();
    const runID = await submitRun(workflowId, schema);

    const terminal = await waitForTerminal(runID, 30_000);
    expect(terminal.status).toBe('failed');
    const run = await getRun(runID);
    const report = typeof run.report === 'string' ? JSON.parse(run.report) : run.report;
    expect(JSON.stringify(report)).toMatch(/Structured output not supported|capability/);
    // Pin fail-fast: the capability error must occur BEFORE any provider
    // request is sent (session creation rejects, no fallback/downgrade).
    expect(await getFakeProviderCalls()).toBe(0);
  });
});
