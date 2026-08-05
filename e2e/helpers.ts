/**
 * Phase 10 (#162) E2E shared helpers.
 *
 * The FlowGram runtime requires a start node and an end node — a bare LLM
 * node fails validation with "Workflow schema must have a start node and an
 * end node". These helpers build valid schemas and drive the backend API
 * for test setup (faster + more deterministic than UI form-filling).
 */

const FAKE_PROVIDER_BASE = 'http://localhost:4011/v1';
const FAKE_API_KEY = 'fake-provider-local';
const SERVER_BASE = 'http://localhost:4099';

export async function createAgent(nameSuffix = Date.now()): Promise<string> {
  const res = await fetch(`${SERVER_BASE}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `E2E Agent ${nameSuffix}`,
      config: {
        provider: {
          base_url: FAKE_PROVIDER_BASE,
          api_key: FAKE_API_KEY,
          model: 'fake-m0',
        },
        system_prompt: 'You are an E2E test agent.',
      },
    }),
  });
  const agent = await res.json();
  return agent.id;
}

/**
 * Build a valid workflow schema: start → llm → end.
 * `prompt` is the LLM node's prompt text. `timeoutOverride` optionally sets
 * the per-node timeout (Phase 9).
 */
export function buildWorkflowSchema(agentId: string, prompt: string, timeoutOverride?: number) {
  const llmData: any = {
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
    outputs: {
      type: 'object',
      properties: { result: { type: 'string' } },
    },
  };
  if (timeoutOverride !== undefined) {
    llmData.timeoutOverride = timeoutOverride;
  }
  return {
    nodes: [
      {
        id: 'start_0',
        type: 'start',
        meta: { position: { x: 100, y: 300 } },
        data: {
          title: 'Start',
          outputs: {
            type: 'object',
            properties: {
              query: { type: 'string', default: 'Hello' },
            },
          },
        },
      },
      {
        id: 'llm_main',
        type: 'llm',
        meta: { position: { x: 540, y: 300 } },
        data: llmData,
      },
      {
        id: 'end_0',
        type: 'end',
        meta: { position: { x: 980, y: 300 } },
        data: {
          title: 'End',
          inputsValues: {
            result: { type: 'ref', content: ['llm_main', 'result'] },
          },
          inputs: {
            type: 'object',
            properties: { result: { type: 'string' } },
          },
        },
      },
    ],
    edges: [
      { sourceNodeID: 'start_0', targetNodeID: 'llm_main' },
      { sourceNodeID: 'llm_main', targetNodeID: 'end_0' },
    ],
  };
}

export async function createWorkflow(name: string, schema: object): Promise<string> {
  const res = await fetch(`${SERVER_BASE}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data: schema }),
  });
  const wf = await res.json();
  return wf.id;
}

export async function getWorkflowSchema(workflowId: string): Promise<any> {
  const res = await fetch(`${SERVER_BASE}/workflows/${workflowId}`);
  const wf = await res.json();
  return typeof wf.data === 'string' ? JSON.parse(wf.data) : wf.data;
}

export async function submitRun(workflowId: string, schema: object): Promise<string> {
  const res = await fetch(`${SERVER_BASE}/api/task/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, workflowId }),
  });
  const body = await res.json();
  return body.runID;
}

export async function getRunStatus(runID: string): Promise<string> {
  const res = await fetch(`${SERVER_BASE}/api/runs/${runID}`);
  const run = await res.json();
  return run.status;
}

export async function getRun(runID: string): Promise<any> {
  const res = await fetch(`${SERVER_BASE}/api/runs/${runID}`);
  return res.json();
}

export async function cancelRun(runID: string): Promise<void> {
  await fetch(`${SERVER_BASE}/api/runs/${runID}/cancel`, { method: 'PUT' });
}

export async function listRuns(workflowId: string): Promise<any[]> {
  const res = await fetch(`${SERVER_BASE}/api/workflows/${workflowId}/runs`);
  return res.json();
}

export async function waitForTerminal(runID: string, timeoutMs = 20_000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const run = await getRun(runID);
    if (['succeeded', 'failed', 'terminated'].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`run ${runID} did not reach terminal within ${timeoutMs}ms`);
}

export async function configureFakeProvider(
  correlationId: string,
  mode:
    | 'success'
    | 'timeout'
    | 'auth_failure'
    | 'empty_output'
    | 'json_response'
    | 'invalid_json'
    | 'refusal'
    | 'incomplete',
  sleepMs?: number,
  rawDetail?: string
): Promise<void> {
  await fetch('http://localhost:4011/test/control', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      correlationId,
      mode,
      ...(sleepMs ? { sleepMs } : {}),
      ...(rawDetail !== undefined ? { rawDetail } : {}),
    }),
  });
}
