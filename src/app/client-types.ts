import type { WorkflowAuthoring, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../lib/workflows/contracts";

export type WorkflowNodeDefinition = WorkflowNode;
export type WorkflowEdgeDefinition = WorkflowEdge;
export type WorkflowDefinitionDocument = WorkflowDefinition;
export type WorkflowAuthoringDocument = WorkflowAuthoring;

export type WorkflowSummary = {
  id: string;
  name: string;
  latestDefinitionVersion: { id: string; version: number; hash: string };
};

export type WorkflowDetail = {
  workflow: { id: string; name: string };
  workflowDefinitionVersion: {
    id: string;
    version: number;
    hash: string;
    definition: WorkflowDefinition;
    authoring: WorkflowAuthoring;
  };
};

export type ResourceVersion = { id: string; version: number; definition: Record<string, unknown>; hash: string };
export type Resource = { id: string; name: string; archivedAt: string | null; latestVersion: ResourceVersion | null };
export type ResourceList = { resources: Resource[] };

export type RuntimeError = { code: string; message: string; nodeId: string };
export type ProviderSnapshot = { bindingAlias: string; effectiveProvider: string; effectiveModel: string; parameters: Record<string, unknown> };
export type NodeOutput = { markdown?: string; [key: string]: unknown };
export type RunNode = {
  id: string;
  nodeId: string;
  type: WorkflowNodeDefinition["type"];
  status: "pending" | "queued" | "running" | "succeeded" | "failed" | "skipped";
  error: RuntimeError | null;
  skipReason: string | null;
  agentDefinitionVersion: { id: string; version: number; hash: string } | null;
  providerBindingRef: string | null;
  input: Record<string, unknown> | null;
  output: NodeOutput | null;
  attempt: { providerSnapshot: ProviderSnapshot | null; agentExecution: { providerSnapshot: ProviderSnapshot | null } | null } | null;
};
export type TimelineArtifact = { source: { kind: "node.output"; nodeId: string }; sha256: string; mediaType: "text/markdown"; sizeBytes: number; sensitivity: "internal"; retentionPolicy: "run-history" };
export type TimelineEvent = { sequence: number; type: string; occurredAt: string; nodeId?: string; code?: string; reason?: string; artifact?: TimelineArtifact };
export type Run = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: RuntimeError | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  workflow: { id: string; name: string };
  workflowDefinitionVersion: { id: string; version: number; hash: string; definition: WorkflowDefinition };
  input: { prompt: string };
  output: NodeOutput | null;
  nodes: RunNode[];
  timeline: TimelineEvent[];
};
export type RunHistoryItem = Omit<Run, "workflow" | "nodes" | "timeline">;
export type ApiError = { code?: string; message?: string; path?: string; nodeId?: string | null };
