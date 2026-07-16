"use client";

import dynamic from "next/dynamic";
import { Component, useState, type ReactNode } from "react";
import type { Run, WorkflowDetail } from "../client-types";
import {
  projectRuntimeOverlay,
  projectVisualWorkflow,
  type RuntimeOverlayNode,
  type VisualWorkflowDocument,
} from "../../lib/workflows/visual-projection";

const FlowGramEditor = dynamic(
  () => import("./flowgram-editor").then((module) => module.FlowGramEditor),
  { ssr: false },
);

declare global {
  var __WORKFLOW_E2E_FORCE_CANVAS_FAILURE__: boolean | undefined;
}

class FlowGramBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type Definition = WorkflowDetail["workflowDefinitionVersion"]["definition"];

function CanvasFallback({ definition }: { definition: Definition }) {
  const titles = {
    "input.prompt": "Input prompt",
    "process.agent": "Agent analysis",
    "output.markdown": "Markdown output",
  } as const;

  return (
    <div className="canvas-fallback" role="status">
      <p>Canvas fallback: FlowGram could not render this Definition.</p>
      <ul aria-label="Read-only Definition">
        {definition.spec.nodes.map((node) => (
          <li key={node.id}>
            <strong>{titles[node.type]}</strong> <span className="mono">{node.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EdgeMetadata({ document }: { document: VisualWorkflowDocument }) {
  return (
    <div className="flowgram-edge-metadata" aria-label="Workflow connections">
      {document.edges.map((edge) => (
        <span
          aria-label={`Connection from ${edge.source} to ${edge.target}`}
          key={`${edge.source}-${edge.target}`}
          role="img"
        />
      ))}
    </div>
  );
}

function FlowGramCanvas({
  configuredModels,
  definition,
  overlay,
  onNodeSelect,
}: {
  configuredModels: Record<string, string | null>;
  definition: Definition;
  overlay: Record<string, RuntimeOverlayNode>;
  onNodeSelect: (nodeId: string) => void;
}) {
  if (
    typeof navigator !== "undefined"
    && navigator.webdriver === true
    && globalThis.__WORKFLOW_E2E_FORCE_CANVAS_FAILURE__ === true
  ) {
    throw new Error("Forced canvas failure");
  }
  const document = projectVisualWorkflow(definition);
  return (
    <>
      <FlowGramEditor
        configuredModels={configuredModels}
        document={document}
        onNodeSelect={onNodeSelect}
        overlay={overlay}
      />
      <EdgeMetadata document={document} />
    </>
  );
}

export function WorkflowBoard({
  configuredModels,
  definition,
  run = null,
}: {
  configuredModels: Record<string, string | null>;
  definition: Definition;
  run?: Run | null;
}) {
  const overlay = run ? projectRuntimeOverlay(run) : {};
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedDefinitionNode = definition.spec.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedRuntimeNode = run?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null;

  return (
    <>
      <section className="board board-flowgram" aria-label="Board">
        <section className="workflow-flowgram-board" role="region" aria-label="Workflow canvas">
          <FlowGramBoundary fallback={<CanvasFallback definition={definition} />}>
            <FlowGramCanvas
              configuredModels={configuredModels}
              definition={definition}
              onNodeSelect={setSelectedNodeId}
              overlay={overlay}
            />
          </FlowGramBoundary>
        </section>
      </section>
      {selectedDefinitionNode ? (
        <aside className="node-detail" role="region" aria-label="Node detail">
          <h2>Node detail</h2>
          <dl>
            <div><dt>ID</dt><dd className="mono">{selectedDefinitionNode.id}</dd></div>
            <div><dt>Type</dt><dd className="mono">{selectedDefinitionNode.type}</dd></div>
            {selectedDefinitionNode.type === "input.prompt" && run ? (
              <div><dt>Prompt</dt><dd>{run.input.prompt}</dd></div>
            ) : null}
            {selectedRuntimeNode?.output ? (
              <div><dt>Output</dt><dd>{selectedRuntimeNode.output.markdown}</dd></div>
            ) : null}
            {selectedRuntimeNode?.error ? (
              <div><dt>Error</dt><dd>{selectedRuntimeNode.error.code}: {selectedRuntimeNode.error.message}</dd></div>
            ) : null}
            {selectedRuntimeNode?.skipReason ? (
              <div><dt>Skipped</dt><dd>{selectedRuntimeNode.skipReason}</dd></div>
            ) : null}
          </dl>
        </aside>
      ) : null}
    </>
  );
}
