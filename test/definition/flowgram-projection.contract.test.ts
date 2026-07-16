import { describe, expect, test } from "vitest";
import type { Run, RunNode } from "../../src/app/client-types";
import { validDefinition } from "./helpers";

type VisualNode = {
  id: string;
  data: { title: string };
};

type VisualEdge = {
  source: string;
  target: string;
};

type VisualWorkflowDocument = {
  nodes: VisualNode[];
  edges: VisualEdge[];
};

type RuntimeOverlayNode = {
  status: "idle" | "processing" | "success" | "fail" | "canceled";
  output: RunNode["output"];
  error: RunNode["error"];
  skipReason: RunNode["skipReason"];
};

function runtimeNode(
  nodeId: string,
  status: RunNode["status"],
  overrides: Partial<RunNode> = {},
): RunNode {
  return {
    id: `node-run-${nodeId}`,
    nodeId,
    type: "process.agent",
    status,
    error: null,
    skipReason: null,
    agentDefinitionVersion: null,
    providerBindingRef: null,
    output: null,
    attempt: null,
    ...overrides,
  };
}

describe("M1-A FlowGram projection", () => {
  test("projects the real definition as a deterministic, non-mutating visual document", async () => {
    const { projectVisualWorkflow } = await import("../../src/lib/workflows/visual-projection");
    const definition = validDefinition("flowgram-projection-contract");
    const originalDefinition = structuredClone(definition);

    const first = projectVisualWorkflow(definition) as VisualWorkflowDocument;
    const second = projectVisualWorkflow(definition) as VisualWorkflowDocument;

    expect(first).toEqual(second);
    expect(definition).toEqual(originalDefinition);
    expect(first.nodes.map((node) => node.id)).toEqual(
      definition.spec.nodes.map((node: { id: string }) => node.id),
    );
    expect(first.nodes.map((node) => ({ id: node.id, title: node.data.title }))).toEqual([
      { id: "prompt", title: "Input prompt" },
      { id: "analyze", title: "Agent analysis" },
      { id: "result", title: "Markdown output" },
    ]);
    expect(first.edges.map(({ source, target }) => ({ source, target }))).toEqual(
      definition.spec.edges.map((edge: { from: string; to: string }) => ({
        source: edge.from,
        target: edge.to,
      })),
    );
  });

  test("projects runtime status and node detail values by product node ID", async () => {
    const { projectRuntimeOverlay } = await import("../../src/lib/workflows/visual-projection");
    const output = { markdown: "Fake provider response" };
    const error = { code: "provider_timeout", message: "Provider timed out", nodeId: "failed" };
    const nodes = [
      runtimeNode("pending", "pending"),
      runtimeNode("queued", "queued"),
      runtimeNode("running", "running"),
      runtimeNode("succeeded", "succeeded", { output }),
      runtimeNode("failed", "failed", { error }),
      runtimeNode("skipped", "skipped", { skipReason: "upstream_failed" }),
    ];

    const overlay = projectRuntimeOverlay({ nodes } as Run) as Record<string, RuntimeOverlayNode>;

    expect(overlay).toMatchObject({
      pending: { status: "idle", output: null, error: null, skipReason: null },
      queued: { status: "idle", output: null, error: null, skipReason: null },
      running: { status: "processing", output: null, error: null, skipReason: null },
      succeeded: { status: "success", output, error: null, skipReason: null },
      failed: { status: "fail", output: null, error, skipReason: null },
      skipped: { status: "canceled", output: null, error: null, skipReason: "upstream_failed" },
    });
    expect(Object.keys(overlay)).toEqual(nodes.map((node) => node.nodeId));
  });
});
