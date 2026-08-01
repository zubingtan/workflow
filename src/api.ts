// Same-origin relative path — T1/T2 (#116) decided the browser talks to the
// same origin that served the HTML (Hono :4001 in both dev and prod). All
// fetch calls below build `${SERVER_URL}/<path>` which, with SERVER_URL = '',
// collapses to a relative URL resolved against window.location. fetch and
// ReadableStream (used by the SSE controller) both support relative URLs.
// (T3 #119 was never merged; folded into T7 #123 to unblock prod-mode E2E —
// the previous `process.env.PUBLIC_SERVER_URL` ref threw "process is not
// defined" in the browser because rsbuild's prod build doesn't polyfill it.)
export const SERVER_URL = '';

export interface AgentConfig {
  provider: {
    base_url: string;
    api_key: string;
    model: string;
    pricing?: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  };
  system_prompt: string;
  session_options: {
    thinkingLevel?: string;
    tools?: string[];
    excludeTools?: string[];
    noTools?: string | null;
  };
  pi_settings: Record<string, any>;
}

export interface AgentDef {
  id: string;
  name: string;
  runtime: string;
  config: string; // JSON string of AgentConfig
  tags: string; // JSON string of string[]
  created_at: string;
  updated_at: string;
}

export interface AgentExecution {
  id: string;
  agent_id: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  trigger_type: 'standalone' | 'workflow_node';
  workflow_run_id: string | null;
  session_file: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface SessionMessage {
  role: string;
  content: string;
  timestamp?: string;
}

export interface SessionDetail {
  messages: SessionMessage[];
  prompt: string | null;
}

export interface AgentExecutionDetail extends AgentExecution {
  sessionDetail: SessionDetail | null;
}

export interface AgentStats {
  overview: {
    totalExecutions: number;
    successRate: number;
    avgDurationMs: number;
  };
  daily: Array<{ date: string; count: number; succeeded: number; failed: number }>;
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

/**
 * Error carrying a structured `code` so the caller can branch on a specific
 * backend refusal (e.g. `workflow_has_active_runs`). Used by `deleteWorkflow`
 * so the manager can show a targeted toast instead of a generic message.
 */
export class ApiError extends Error {
  code: string;

  status: number;

  detail?: unknown;

  constructor(message: string, code: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
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

export const deleteWorkflow = async (id: string) => {
  const res = await fetch(`${SERVER_URL}/workflows/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new ApiError(
      body.error || `HTTP ${res.status}`,
      body.error || `http_${res.status}`,
      res.status,
      body
    );
  }
  return res.json();
};

export const copyWorkflow = (id: string) =>
  fetch(`${SERVER_URL}/workflows/${id}/copy`, { method: 'POST' }).then((r) =>
    json<WorkflowDetail>(r)
  );

// --- Agents ---
export const listAgents = () => fetch(`${SERVER_URL}/agents`).then((r) => json<AgentDef[]>(r));

export const createAgent = (body: {
  name?: string;
  runtime?: string;
  config?: any;
  tags?: string[];
}) =>
  fetch(`${SERVER_URL}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => json<AgentDef>(r));

export const updateAgent = (id: string, patch: { name?: string; config?: any; tags?: string[] }) =>
  fetch(`${SERVER_URL}/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => json<AgentDef>(r));

export const deleteAgent = (id: string) =>
  fetch(`${SERVER_URL}/agents/${id}`, { method: 'DELETE' }).then((r) => json(r));

export const copyAgent = (id: string) =>
  fetch(`${SERVER_URL}/agents/${id}/copy`, { method: 'POST' }).then((r) => json<AgentDef>(r));

// --- Agent executions ---
export const listExecutions = (
  agentId: string,
  params?: { limit?: number; offset?: number; status?: string }
) => {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.status) qs.set('status', params.status);
  const q = qs.toString();
  return fetch(`${SERVER_URL}/agents/${agentId}/executions${q ? `?${q}` : ''}`).then((r) =>
    json<AgentExecution[]>(r)
  );
};

export const deleteExecution = (agentId: string, execId: string) =>
  fetch(`${SERVER_URL}/agents/${agentId}/executions/${execId}`, { method: 'DELETE' }).then((r) =>
    json(r)
  );

export const getExecutionDetail = (agentId: string, execId: string) =>
  fetch(`${SERVER_URL}/agents/${agentId}/executions/${execId}`).then((r) =>
    json<AgentExecutionDetail>(r)
  );

// --- Agent stats ---
export const getAgentStats = (agentId: string) =>
  fetch(`${SERVER_URL}/agents/${agentId}/stats`).then((r) => json<AgentStats>(r));

// --- Agent export/import ---
export const exportAgent = (agentId: string, includeSecrets = false) =>
  fetch(
    `${SERVER_URL}/agents/${agentId}/export${includeSecrets ? '?include_secrets=true' : ''}`
  ).then((r) => json<any>(r));

export const exportAgents = (includeSecrets = false) =>
  fetch(`${SERVER_URL}/agents/export${includeSecrets ? '?include_secrets=true' : ''}`).then((r) =>
    json<any[]>(r)
  );

export const importAgentsPrecheck = (agents: any[]) =>
  fetch(`${SERVER_URL}/agents/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agents),
  }).then((r) => json<{ total: number; conflicts: string[]; importable: number }>(r));

export const importAgentsConfirm = (agents: any[], onConflict: 'skip' | 'overwrite' | 'rename') =>
  fetch(`${SERVER_URL}/agents/import/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agents, on_conflict: onConflict }),
  }).then((r) => json<{ created: number; skipped: number; overwritten: number }>(r));

// --- Agent test (config without saving) ---
export const testAgent = (config: any, signal?: AbortSignal) =>
  fetch(`${SERVER_URL}/agents/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
    signal,
  });

// --- Agent run by id (LLM node path) ---
// Returns the raw Response so the hook can parse the SSE body uniformly.
// Sends only { prompt }; agentId is in the URL. The API key is stored in the
// DB (sent at agent create/update time) and resolved server-side.
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

// --- Run management (Phase 3: queue status + unified cancel) ---
// These are for saved-workflow runs (POST /api/task/run with workflowId
// returns {runID, status:'queued'}). Draft runs use the taskID-based
// /api/task/* endpoints via WorkflowRuntimeServerClient and bypass these.

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'terminated';

export interface RunStatusResponse {
  status: RunStatus;
  task_id: string | null;
  queued_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  queuePosition: number; // 1-based for queued runs; 0 for running/terminal/missing
}

export interface RunCancelResponse {
  ok?: boolean;
  status?: 'terminated'; // only present when cancelling a queued run (immediate terminate)
  success?: boolean; // present when cancelling a running run (best-effort; row stays running until Phase 4 onTerminal)
  error?: string;
}

export const getRunStatus = (runID: string) =>
  fetch(`${SERVER_URL}/api/runs/${runID}`).then((r) => json<RunStatusResponse>(r));

export const cancelRun = (runID: string) =>
  fetch(`${SERVER_URL}/api/runs/${runID}/cancel`, { method: 'PUT' }).then((r) =>
    json<RunCancelResponse>(r)
  );

// --- Run history (Phase 5/7: REST list + full detail + delete) ---
// These back the History Modal. The list endpoint excludes the heavy
// report/schema_snapshot columns; getRun fetches the full row for the
// detail viewer. deleteRun refuses non-terminal runs with 409 (server-side).

export interface RunMeta {
  id: string;
  status: RunStatus;
  task_id: string | null;
  queued_at: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface RunDetail extends RunMeta {
  workflow_id: string;
  report: any;
  schema_snapshot: any;
  queuePosition: number;
}

export const listRuns = (workflowId: string) =>
  fetch(`${SERVER_URL}/api/workflows/${workflowId}/runs`).then((r) => json<RunMeta[]>(r));

export const getRun = (runID: string) =>
  fetch(`${SERVER_URL}/api/runs/${runID}`).then((r) => json<RunDetail>(r));

export const deleteRun = (runID: string) =>
  fetch(`${SERVER_URL}/api/runs/${runID}`, { method: 'DELETE' }).then((r) => json(r));

// --- Phase 9 (#161): global settings (node timeout default, etc.) ---

export interface AppSettings {
  node_timeout_default_ms: number | null;
  mem0_host: string | null;
  mem0_api_key: string | null;
}

export const getSettings = () =>
  fetch(`${SERVER_URL}/api/settings`).then((r) => json<AppSettings>(r));

export const updateSettings = (patch: Partial<AppSettings>) =>
  fetch(`${SERVER_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).then((r) => json<AppSettings>(r));
