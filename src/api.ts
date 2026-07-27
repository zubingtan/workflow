// Same-origin relative path — T1/T2 (#116) decided the browser talks to the
// same origin that served the HTML (Hono :4001 in both dev and prod). All
// fetch calls below build `${SERVER_URL}/<path>` which, with SERVER_URL = '',
// collapses to a relative URL resolved against window.location. fetch and
// ReadableStream (used by the SSE controller) both support relative URLs.
export const SERVER_URL = '';

export interface AgentDef {
  id: string;
  name: string;
  provider_base_url: string;
  provider_api_key_env: string;
  model: string;
  system_prompt: string;
  temperature: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowMeta {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowDetail extends WorkflowMeta {
  data: any;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// --- Workflows ---
export const listWorkflows = () =>
  fetch(`${SERVER_URL}/workflows`).then((r) => json<WorkflowMeta[]>(r));

export const getWorkflow = (id: string) =>
  fetch(`${SERVER_URL}/workflows/${id}`).then((r) => json<WorkflowDetail>(r));

export const createWorkflow = (name: string, data: any) =>
  fetch(`${SERVER_URL}/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, data }),
  }).then((r) => json<WorkflowDetail>(r));

export const updateWorkflow = (id: string, patch: { name?: string; data?: any }) =>
  fetch(`${SERVER_URL}/workflows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => json<WorkflowDetail>(r));

export const deleteWorkflow = (id: string) =>
  fetch(`${SERVER_URL}/workflows/${id}`, { method: 'DELETE' }).then((r) => json(r));

export const copyWorkflow = (id: string) =>
  fetch(`${SERVER_URL}/workflows/${id}/copy`, { method: 'POST' }).then((r) =>
    json<WorkflowDetail>(r)
  );

// --- Agents ---
export const listAgents = () => fetch(`${SERVER_URL}/agents`).then((r) => json<AgentDef[]>(r));

export const createAgent = (body: Partial<AgentDef>) =>
  fetch(`${SERVER_URL}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => json<AgentDef>(r));

export const updateAgent = (id: string, patch: Partial<AgentDef>) =>
  fetch(`${SERVER_URL}/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => json<AgentDef>(r));

export const deleteAgent = (id: string) =>
  fetch(`${SERVER_URL}/agents/${id}`, { method: 'DELETE' }).then((r) => json(r));

export const copyAgent = (id: string) =>
  fetch(`${SERVER_URL}/agents/${id}/copy`, { method: 'POST' }).then((r) => json<AgentDef>(r));

// --- Agent test (config without saving) ---
export const testAgent = (config: Partial<AgentDef> & { prompt?: string }, signal?: AbortSignal) =>
  fetch(`${SERVER_URL}/agents/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal,
  });

// --- Agent run by id (LLM node path) ---
// Returns the raw Response so the hook can parse the SSE body uniformly.
// Sends only { prompt }; agentId is in the URL. The API key value never
// crosses this boundary (resolved server-side via provider_api_key_env).
export const runAgentById = (agentId: string, prompt: string, signal?: AbortSignal) =>
  fetch(`${SERVER_URL}/agents/${agentId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal,
  });

// --- Agent fetch by id (single-agent lookup; used by LLM node form) ---
export const getAgent = (id: string) =>
  fetch(`${SERVER_URL}/agents/${id}`).then((r) => json<AgentDef>(r));

// --- Env vars (names only) ---
export const getEnvVars = () => fetch(`${SERVER_URL}/env/vars`).then((r) => json<string[]>(r));
