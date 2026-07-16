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
import type {
  RuntimeOverlayNode,
  VisualWorkflowDocument,
  VisualWorkflowNode,
} from "../../lib/workflows/visual-projection";

function statusLabel(status: RuntimeOverlayNode["status"]) {
  return {
    idle: "Queued",
    processing: "Running",
    success: "Succeeded",
    fail: "Failed",
    canceled: "Skipped",
  }[status];
}

function createNodeRenderer(
  nodesById: ReadonlyMap<string, VisualWorkflowNode>,
  overlay: Readonly<Record<string, RuntimeOverlayNode>>,
  configuredModels: Readonly<Record<string, string | null>>,
  onNodeSelect: (nodeId: string) => void,
) {
  return function FlowGramNode({ node }: WorkflowNodeProps) {
    const { selectNode } = useNodeRender(node);
    const visualNode = nodesById.get(node.id);
    if (!visualNode) return null;
    const runtime = overlay[visualNode.id];
    const binding = runtime?.providerBindingRef ?? visualNode.data.providerBindingRef;
    const agentVersion = runtime?.agentVersionId ?? visualNode.data.agentVersionRef;

    return (
      <WorkflowNodeRenderer node={node} className="flowgram-rendered-node">
        <article
          className={`node-card${runtime ? ` status-${runtime.status}` : ""}`}
          data-product-node-id={visualNode.id}
        >
          <button
            aria-label={`${visualNode.data.title} (${visualNode.id})`}
            className="flowgram-node-button"
            data-product-node-id={visualNode.id}
            onClick={(event) => {
              selectNode(event);
              onNodeSelect(visualNode.id);
            }}
            type="button"
          >
            <div className="node-heading">
              <span className="node-icon" aria-hidden="true" />
              <div>
                <h2>{visualNode.data.title}</h2>
                <p className="mono">{visualNode.data.productNodeType}</p>
              </div>
            </div>
            {visualNode.data.productNodeType === "process.agent" ? (
              <dl className="node-facts">
                <div><dt>Provider binding</dt><dd>{binding}</dd></div>
                <div><dt>Agent version</dt><dd>{agentVersion}</dd></div>
                <div><dt>Configured model</dt><dd>{configuredModels[binding ?? ""] ?? "Unavailable"}</dd></div>
                {runtime ? <div><dt>Effective model</dt><dd>{runtime.effectiveModel ?? "Awaiting dispatch"}</dd></div> : null}
              </dl>
            ) : null}
            {runtime ? (
              <span className="node-status">{statusLabel(runtime.status)}</span>
            ) : <span className="node-status neutral">Configured</span>}
          </button>
        </article>
      </WorkflowNodeRenderer>
    );
  };
}

export function FlowGramEditor({
  document,
  overlay,
  configuredModels,
  onNodeSelect,
}: {
  document: VisualWorkflowDocument;
  overlay: Readonly<Record<string, RuntimeOverlayNode>>;
  configuredModels: Readonly<Record<string, string | null>>;
  onNodeSelect: (nodeId: string) => void;
}) {
  const initialData = useMemo<WorkflowJSON>(() => ({
    nodes: document.nodes.map(({ id, type, data, meta }) => ({ id, type, data, meta })),
    edges: document.edges.map(({ sourceNodeID, targetNodeID }) => ({ sourceNodeID, targetNodeID })),
  }), [document]);
  const nodesById = useMemo(() => new Map(document.nodes.map((node) => [node.id, node])), [document]);
  const NodeRenderer = useMemo(
    () => createNodeRenderer(nodesById, overlay, configuredModels, onNodeSelect),
    [configuredModels, nodesById, onNodeSelect, overlay],
  );
  const editorKey = document.nodes.map((node) => `${node.id}:${overlay[node.id]?.status ?? "definition"}`).join("|");

  return (
    <div className="flowgram-editor">
      <FreeLayoutEditorProvider
        key={editorKey}
        initialData={initialData}
        materials={{ renderDefaultNode: NodeRenderer }}
        readonly
        scroll={{ disableScrollBar: true }}
      >
        <EditorRenderer />
      </FreeLayoutEditorProvider>
    </div>
  );
}
