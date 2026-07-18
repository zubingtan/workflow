import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./contracts";

export type AddNodeChoice = {
  type: WorkflowNode["type"];
  disabled: boolean;
  reason?: string;
};

const nodeTypes: WorkflowNode["type"][] = ["input.prompt", "task.agent", "logic.condition", "output.markdown"];

export function addNodeChoices(definition: WorkflowDefinition): AddNodeChoice[] {
  const hasInput = definition.spec.nodes.some((node) => node.type === "input.prompt");
  return nodeTypes.map((type) => type === "input.prompt" && hasInput
    ? { type, disabled: true, reason: "An Input node already exists for this workflow." }
    : { type, disabled: false });
}

type Inserted = { status: "inserted"; definition: WorkflowDefinition };
type NeedsConnection = { status: "needs_connection"; message: string; definition: WorkflowDefinition };

function targetPort(node: WorkflowNode) {
  if (node.type === "input.prompt") return undefined;
  return node.type === "output.markdown" ? "output" : "prompt";
}

function sourcePort(node: WorkflowNode) {
  if (node.type === "input.prompt") return "prompt";
  return node.type === "task.agent" ? "output" : undefined;
}

function conditionMappingSource(source: WorkflowNode, edge: WorkflowEdge, mapping: WorkflowEdge["mapping"][number]) {
  if (source.type === "logic.condition") return mapping.source;
  if (source.type === "input.prompt") return "input.prompt";
  return `${source.id}.${edge.sourcePort ?? "output"}`;
}

export function insertNodeOnSelectedEdge(definition: WorkflowDefinition, selectedEdge: WorkflowEdge | undefined, node: WorkflowNode): Inserted | NeedsConnection {
  const edgeIndex = selectedEdge ? definition.spec.edges.indexOf(selectedEdge) : -1;
  if (edgeIndex < 0) return { status: "needs_connection", message: "Select a connection before adding a node.", definition };

  const edge = definition.spec.edges[edgeIndex];
  const insertedTargetPort = targetPort(node);
  const insertedSourcePort = sourcePort(node);
  if (!insertedTargetPort) return { status: "needs_connection", message: "Select a connection compatible with this node type.", definition };
  const upstream: WorkflowEdge = {
    from: edge.from,
    ...(edge.sourcePort ? { sourcePort: edge.sourcePort } : {}),
    to: node.id,
    targetPort: insertedTargetPort,
    mapping: edge.mapping.map((mapping) => ({ source: mapping.source, target: insertedTargetPort })),
  };
  if (node.type === "logic.condition") {
    const downstream = node.config.branches.map((branch) => ({
      from: node.id,
      sourcePort: branch.id,
      to: edge.to,
      ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
      mapping: edge.mapping.map((mapping) => ({ source: conditionMappingSource(definition.spec.nodes.find((candidate) => candidate.id === edge.from)!, edge, mapping), target: mapping.target })),
    }));
    return {
      status: "inserted",
      definition: {
        ...definition,
        spec: {
          ...definition.spec,
          nodes: [...definition.spec.nodes, node],
          edges: [...definition.spec.edges.slice(0, edgeIndex), upstream, ...downstream, ...definition.spec.edges.slice(edgeIndex + 1)],
        },
      },
    };
  }
  if (!insertedSourcePort) return { status: "needs_connection", message: "Select a connection compatible with this node type.", definition };
  const downstream: WorkflowEdge = {
    from: node.id,
    to: edge.to,
    ...(edge.targetPort ? { targetPort: edge.targetPort } : {}),
    mapping: edge.mapping.map((mapping) => ({ source: insertedSourcePort, target: mapping.target })),
  };
  return {
    status: "inserted",
    definition: {
      ...definition,
      spec: {
        ...definition.spec,
        nodes: [...definition.spec.nodes, node],
        edges: [...definition.spec.edges.slice(0, edgeIndex), upstream, downstream, ...definition.spec.edges.slice(edgeIndex + 1)],
      },
    },
  };
}
