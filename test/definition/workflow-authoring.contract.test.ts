import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { addNodeChoices, insertNodeOnSelectedEdge } from "../../src/lib/workflows/authoring";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../../src/lib/workflows/contracts";

function definition(): WorkflowDefinition {
  return {
    apiVersion: "workflow/v1alpha1",
    kind: "Workflow",
    metadata: { name: "authoring" },
    spec: {
      nodes: [
        { id: "prompt", type: "input.prompt", config: {} },
        { id: "route", type: "logic.condition", config: { branches: [{ id: "match", condition: { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "match" } } }, { id: "else" }] } },
        { id: "result", type: "output.markdown", config: {} },
      ],
      edges: [
        { from: "prompt", to: "route", targetPort: "prompt", mapping: [{ source: "prompt", target: "prompt" }] },
        { from: "route", sourcePort: "match", to: "result", targetPort: "output", mapping: [{ source: "input.prompt", target: "output" }] },
        { from: "route", sourcePort: "else", to: "result", targetPort: "output", mapping: [{ source: "input.prompt", target: "output" }] },
      ],
    },
  };
}

describe("Workflow Builder Add Node authoring rules", () => {
  test("creates a new Agent with the safe fake provider binding", async () => {
    const board = await readFile(resolve(process.cwd(), "src/app/components/workflow-board.tsx"), "utf8");

    expect(board).toMatch(/type === "task\.agent"\) return \{ id, type, config: \{[^}]*providerBindingRef: "fake-default"/u);
  });

  test("keeps only Prompt unavailable once the workflow already has its Input", () => {
    const choices = addNodeChoices(definition());

    expect(choices.find((choice) => choice.type === "input.prompt")).toMatchObject({
      disabled: true,
      reason: "An Input node already exists for this workflow.",
    });
    expect(choices.find((choice) => choice.type === "output.markdown")).toMatchObject({ disabled: false });
    expect(choices.find((choice) => choice.type === "task.agent")).toMatchObject({ disabled: false });
    expect(choices.find((choice) => choice.type === "logic.condition")).toMatchObject({ disabled: false });
  });

  test("inserts a node into the selected edge while preserving condition and target-port semantics", () => {
    const workflow = definition();
    const selectedEdge = workflow.spec.edges[1] as WorkflowEdge;
    const added: Extract<WorkflowNode, { type: "task.agent" }> = {
      id: "agent",
      type: "task.agent",
      config: { systemPrompt: "summarize", skillVersionRefs: [], mcpServerVersionRefs: [], providerBindingRef: "fake-default", agentVersionRef: null },
    };

    const result = insertNodeOnSelectedEdge(workflow, selectedEdge, added);

    expect(result.status).toBe("inserted");
    expect(result.definition.spec.nodes).toContainEqual(added);
    expect(result.definition.spec.edges).toEqual([
      workflow.spec.edges[0],
      { from: "route", sourcePort: "match", to: "agent", targetPort: "prompt", mapping: [{ source: "input.prompt", target: "prompt" }] },
      { from: "agent", to: "result", targetPort: "output", mapping: [{ source: "output", target: "output" }] },
      workflow.spec.edges[2],
    ]);
  });

  test("makes missing edge selection actionable instead of silently creating an unsaveable graph", () => {
    const workflow = definition();
    const added: WorkflowNode = { id: "agent", type: "task.agent", config: { systemPrompt: "summarize", skillVersionRefs: [], mcpServerVersionRefs: [], providerBindingRef: "fake-default", agentVersionRef: null } };

    const result = insertNodeOnSelectedEdge(workflow, undefined, added);

    expect(result).toMatchObject({
      status: "needs_connection",
      message: expect.stringMatching(/select.*connection/i),
      definition: workflow,
    });
  });
});
