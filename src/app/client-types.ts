export type WorkflowNodeDefinition = {
  id: string;
  type: "input.prompt" | "process.agent" | "output.markdown";
  config: {
    agentVersionRef?: string;
    providerBindingRef?: string;
  };
};

export type WorkflowSummary = {
  id: string;
  name: string;
  latestDefinitionVersion: {
    id: string;
    version: number;
    hash: string;
  };
};

export type WorkflowDetail = {
  workflow: { id: string; name: string };
  workflowDefinitionVersion: {
    id: string;
    version: number;
    hash: string;
    definition: {
      spec: { nodes: WorkflowNodeDefinition[] };
    };
  };
};

export type RuntimeError = {
  code: string;
  message: string;
  nodeId: string;
};

export type ProviderSnapshot = {
  bindingAlias: string;
  effectiveProvider: string;
  effectiveModel: string;
  parameters: Record<string, unknown>;
};

export type RunNode = {
  id: string;
  nodeId: string;
  type: WorkflowNodeDefinition["type"];
  status: "pending" | "queued" | "running" | "succeeded" | "failed" | "skipped";
  error: RuntimeError | null;
  skipReason: string | null;
  agentDefinitionVersion: { id: string; version: number; hash: string } | null;
  providerBindingRef: string | null;
  output: { markdown: string } | null;
  attempt: {
    providerSnapshot: ProviderSnapshot | null;
    agentExecution: { providerSnapshot: ProviderSnapshot | null } | null;
  } | null;
};

export type Run = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: RuntimeError | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  workflow: { id: string; name: string };
  workflowDefinitionVersion: { id: string; version: number; hash: string };
  input: { prompt: string };
  nodes: RunNode[];
};

export type RunHistoryItem = Omit<Run, "workflow" | "nodes">;

export type ApiError = {
  code?: string;
  message?: string;
  path?: string;
  nodeId?: string | null;
};
