"use client";

import {
  EditorRenderer,
  FreeLayoutEditorProvider,
  WorkflowNodeRenderer,
  type WorkflowJSON,
  type WorkflowNodeProps,
  useNodeRender,
} from "@flowgram.ai/free-layout-editor";
import { useMemo } from "react";
import type { ConditionClause, ConditionExpression, WorkflowAuthoring, WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../../lib/workflows/contracts";
import type { RuntimeOverlayNode } from "../../lib/workflows/visual-projection";

const labels: Record<WorkflowNode["type"], string> = {
  "input.prompt": "Input",
  "task.agent": "Agent",
  "logic.condition": "Condition",
  "output.markdown": "Output",
};

function ports(node: WorkflowNode) {
  const output = node.type === "logic.condition"
    ? node.config.branches.map((branch, index) => ({ portID: branch.id, type: "output" as const, locationConfig: { right: 0, top: `${((index + 1) / (node.config.branches.length + 1)) * 100}%` } }))
    : node.type === "output.markdown" ? [] : [{ portID: node.type === "input.prompt" ? "prompt" : "output", type: "output" as const }];
  const input = node.type === "input.prompt" ? [] : [{
    portID: node.type === "task.agent" ? "prompt" : node.type === "output.markdown" ? "output" : "prompt",
    type: "input" as const,
  }];
  return [...input, ...output];
}

function defaultMapping(source: WorkflowNode, target: WorkflowNode) {
  if (source.type === "logic.condition") return [];
  return [{ source: source.type === "input.prompt" ? "prompt" : "output", target: target.type === "output.markdown" ? "output" : "prompt" }];
}

function canvasJson(definition: WorkflowDefinition, authoring: WorkflowAuthoring): WorkflowJSON {
  return {
    nodes: definition.spec.nodes.map((node, index) => ({
      id: node.id,
      type: node.type,
      data: { productNodeType: node.type },
      meta: { position: authoring.nodes?.[node.id]?.position ?? { x: 120 + index * 270, y: 130 }, defaultPorts: ports(node) },
    })),
    edges: definition.spec.edges.map((edge) => ({ sourceNodeID: edge.from, targetNodeID: edge.to, sourcePortID: edge.sourcePort, targetPortID: edge.targetPort })),
  };
}

function createRenderer(nodes: ReadonlyMap<string, WorkflowNode>, onNodeSelect: (id: string) => void, runtimeNodes: Record<string, RuntimeOverlayNode> | undefined, readOnly: boolean) {
  return function FlowGramNode({ node }: WorkflowNodeProps) {
    const { selectNode, deleteNode } = useNodeRender(node);
    const productNode = nodes.get(node.id);
    const runtime = runtimeNodes?.[node.id];
    if (!productNode) return null;
    return (
      <WorkflowNodeRenderer node={node} className="flowgram-rendered-node">
        <article className={`builder-node builder-node-${productNode.type.replace(".", "-")}${runtime ? ` runtime-status-${runtime.status}` : ""}`} data-product-node-id={node.id} {...(runtime ? { "data-runtime-status": runtime.status, "data-skip-reason": runtime.skipReason ?? undefined } : {})}>
          <button className="builder-node-main" type="button" onClick={(event) => { selectNode(event); onNodeSelect(node.id); }} aria-label={`${labels[productNode.type]} node ${node.id}`}>
            <span className="builder-node-icon" aria-hidden="true">{productNode.type === "logic.condition" ? "IF" : productNode.type === "task.agent" ? "AI" : "→"}</span>
            <span><strong>{labels[productNode.type]}</strong><small>{productNode.type}</small></span>
          </button>
          {productNode.type === "logic.condition" ? <ConditionSummary node={productNode} /> : null}
          {runtime ? <p className="builder-node-runtime-status">{runtime.status === "canceled" ? `Skipped${runtime.skipReason ? ` · ${runtime.skipReason.replaceAll("_", " ")}` : ""}` : runtime.status === "processing" ? "Running" : runtime.status === "success" ? "Succeeded" : runtime.status === "fail" ? "Failed" : "Pending"}</p> : null}
          {!readOnly ? <button className="builder-node-delete" type="button" aria-label={`Delete ${labels[productNode.type]} node`} onClick={deleteNode}>×</button> : null}
        </article>
      </WorkflowNodeRenderer>
    );
  };
}

function existingMapping(definition: WorkflowDefinition, edge: { sourceNodeID: string; targetNodeID: string; sourcePortID?: string | number; targetPortID?: string | number }, source: WorkflowNode, target: WorkflowNode) {
  return definition.spec.edges.find((candidate) => candidate.from === edge.sourceNodeID
    && candidate.to === edge.targetNodeID
    && (candidate.sourcePort ?? "") === String(edge.sourcePortID ?? "")
    && (candidate.targetPort ?? "") === String(edge.targetPortID ?? ""))?.mapping ?? defaultMapping(source, target);
}

function ConditionSummary({ node }: { node: Extract<WorkflowNode, { type: "logic.condition" }> }) {
  const conditional = node.config.branches.filter((branch) => branch.condition);
  const fallback = node.config.branches.find((branch) => !branch.condition);
  const visible = conditional.slice(0, 3);
  const hiddenCount = Math.max(0, conditional.length - visible.length);
  return <div className="condition-summary">
    {visible.map((branch, index) => <span key={branch.id}>{`${index === 0 ? "If" : "Else if"} ${summary(branch.condition)}`}</span>)}
    {fallback ? <span>Else</span> : null}
    {hiddenCount > 0 ? <span>+{hiddenCount} more</span> : null}
  </div>;
}

function summary(expression: Extract<WorkflowNode, { type: "logic.condition" }>["config"]["branches"][number]["condition"]): string {
  if (!expression) return "";
  const leaves = conditionLeaves(expression);
  const shown = leaves.slice(0, 3).map((leaf) => `${leaf.left.ref} ${leaf.operator} ${"ref" in leaf.right ? leaf.right.ref : JSON.stringify(leaf.right.literal)}`);
  return `${shown.join(" and ")}${leaves.length > shown.length ? ` +${leaves.length - shown.length} more` : ""}`;
}

function conditionLeaves(expression: ConditionExpression): ConditionClause[] {
  if (!expression) return [];
  if ("group" in expression) return expression.children.flatMap(conditionLeaves);
  return [expression];
}

export function FlowGramEditor({ definition, authoring, onGraphChange, onNodeSelect, runtimeNodes, readOnly = false }: {
  definition: WorkflowDefinition;
  authoring: WorkflowAuthoring;
  onGraphChange: (definition: WorkflowDefinition, authoring: WorkflowAuthoring) => void;
  onNodeSelect: (nodeId: string) => void;
  runtimeNodes?: Record<string, RuntimeOverlayNode>;
  readOnly?: boolean;
}) {
  const initialData = useMemo(() => canvasJson(definition, authoring), [definition.spec.edges, definition.spec.nodes, authoring.nodes]);
  const nodes = useMemo(() => new Map(definition.spec.nodes.map((node) => [node.id, node])), [definition.spec.nodes]);
  const NodeRenderer = useMemo(() => createRenderer(nodes, onNodeSelect, runtimeNodes, readOnly), [nodes, onNodeSelect, runtimeNodes, readOnly]);
  const editorKey = `${definition.spec.nodes.map((node) => `${node.id}:${node.type}`).join("|")}/${definition.spec.edges.map((edge) => `${edge.from}:${edge.sourcePort ?? ""}:${edge.to}`).join("|")}`;

  return <div className="flowgram-editor"><FreeLayoutEditorProvider
    key={editorKey}
    initialData={initialData}
    materials={{ renderDefaultNode: NodeRenderer }}
    scroll={{ disableScrollBar: true }}
    onContentChange={(context) => {
      const canvas = context.document.toJSON();
      const byId = new Map(definition.spec.nodes.map((node) => [node.id, node]));
      const nextNodes = canvas.nodes.map((canvasNode) => byId.get(canvasNode.id)).filter((node): node is WorkflowNode => Boolean(node));
      const nextEdges: WorkflowEdge[] = canvas.edges.flatMap((edge) => {
        const source = byId.get(edge.sourceNodeID); const target = byId.get(edge.targetNodeID);
        if (!source || !target) return [];
        return [{ from: source.id, to: target.id, ...(edge.sourcePortID ? { sourcePort: String(edge.sourcePortID) } : {}), ...(edge.targetPortID ? { targetPort: String(edge.targetPortID) } : {}), mapping: existingMapping(definition, edge, source, target) }];
      });
      const positions = Object.fromEntries(canvas.nodes.flatMap((node) => node.meta?.position ? [[node.id, { position: node.meta.position }]] : []));
      onGraphChange({ ...definition, spec: { ...definition.spec, nodes: nextNodes, edges: nextEdges } }, { ...authoring, nodes: positions } as WorkflowAuthoring);
    }}
  ><EditorRenderer /></FreeLayoutEditorProvider></div>;
}
