import type { Run, RunNode, WorkflowEdgeDefinition, WorkflowNodeDefinition } from "../../app/client-types";

type WorkflowVisualSource = {
  spec: {
    nodes: readonly WorkflowNodeDefinition[];
    edges: readonly WorkflowEdgeDefinition[];
  };
};

export type VisualWorkflowNode = {
  id: string;
  type: "workflow-node";
  data: {
    title: string;
    productNodeId: string;
    productNodeType: WorkflowNodeDefinition["type"];
    providerBindingRef: string | null;
  };
  meta: { position: { x: number; y: number } };
};

export type VisualWorkflowEdge = {
  source: string;
  target: string;
  sourceNodeID: string;
  targetNodeID: string;
};

export type VisualWorkflowDocument = {
  nodes: VisualWorkflowNode[];
  edges: VisualWorkflowEdge[];
};

export type RuntimeOverlayNode = {
  status: "idle" | "processing" | "success" | "fail" | "canceled";
  output: RunNode["output"];
  error: RunNode["error"];
  skipReason: RunNode["skipReason"];
  providerBindingRef: string | null;
  agentVersionId: string | null;
  effectiveModel: string | null;
};

const nodeTitles: Record<WorkflowNodeDefinition["type"], string> = {
  "input.prompt": "Input prompt",
  "task.agent": "Agent",
  "logic.condition": "Condition",
  "output.markdown": "Markdown output",
};

const runtimeStatuses: Record<RunNode["status"], RuntimeOverlayNode["status"]> = {
  pending: "idle",
  queued: "idle",
  running: "processing",
  succeeded: "success",
  failed: "fail",
  skipped: "canceled",
};

function isWorkflowVisualSource(value: unknown): value is WorkflowVisualSource {
  if (value === null || typeof value !== "object" || !("spec" in value)) return false;
  const spec = value.spec;
  return spec !== null
    && typeof spec === "object"
    && "nodes" in spec
    && Array.isArray(spec.nodes)
    && "edges" in spec
    && Array.isArray(spec.edges);
}

export function projectVisualWorkflow(definition: WorkflowVisualSource): VisualWorkflowDocument;
export function projectVisualWorkflow(definition: Record<string, unknown>): VisualWorkflowDocument;
export function projectVisualWorkflow(definition: unknown): VisualWorkflowDocument {
  if (!isWorkflowVisualSource(definition)) throw new TypeError("Workflow definition has no visual graph");
  return {
    nodes: definition.spec.nodes.map((node, index) => ({
      id: node.id,
      type: "workflow-node",
      data: {
        title: nodeTitles[node.type],
        productNodeId: node.id,
        productNodeType: node.type,
        providerBindingRef: "providerBindingRef" in node.config ? node.config.providerBindingRef ?? null : null,
      },
      meta: { position: { x: 180 + (index * 270), y: 92 } },
    })),
    edges: definition.spec.edges.map((edge) => ({
      source: edge.from,
      target: edge.to,
      sourceNodeID: edge.from,
      targetNodeID: edge.to,
    })),
  };
}

export function projectRuntimeOverlay(run: Pick<Run, "nodes">): Record<string, RuntimeOverlayNode> {
  return Object.fromEntries(run.nodes.map((node) => [node.nodeId, {
    status: runtimeStatuses[node.status],
    output: node.output,
    error: node.error,
    skipReason: node.skipReason,
    providerBindingRef: node.providerBindingRef,
    agentVersionId: node.agentDefinitionVersion?.id ?? null,
    effectiveModel: node.attempt?.agentExecution?.providerSnapshot?.effectiveModel
      ?? node.attempt?.providerSnapshot?.effectiveModel
      ?? null,
  }]));
}
