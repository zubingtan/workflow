import { describe, expect, test } from "vitest";
import { compileWorkflowDefinition, evaluateCondition } from "../../src/lib/workflows/compiler";
import { edgeIsSelected, readValue, selectedBranch, topologicalNodes } from "../../src/lib/runs/scheduler";
import type { WorkflowDefinition, WorkflowNode } from "../../src/lib/workflows/contracts";

const condition = {
  type: "group" as const,
  group: "and" as const,
  children: [{ left: { ref: "input.prompt" }, operator: "contains" as const, right: { literal: "A" } }],
};

describe("workflow/v1alpha1 condition scheduler", () => {
  test("recursively evaluates a group and selects the first matching branch", () => {
    const node = { id: "if", type: "logic.condition" as const, config: { branches: [{ id: "a", condition }, { id: "b", condition: { left: { ref: "input.prompt" }, operator: "contains" as const, right: { literal: "B" } } }, { id: "else" }] } };
    expect(evaluateCondition(condition, { "input.prompt": "A" })).toBe(true);
    expect(selectedBranch(node, { "input.prompt": "AB" })).toBe("a");
    expect(selectedBranch(node, { "input.prompt": "B" })).toBe("b");
    expect(selectedBranch(node, { "input.prompt": "none" })).toBe("else");
  });

  test("rejects invalid regex before a workflow can be saved", async () => {
    await expect(compileWorkflowDefinition({ apiVersion: "workflow/v1alpha1", kind: "Workflow", metadata: { name: "bad" }, spec: { nodes: [{ id: "input", type: "input.prompt", config: {} }, { id: "if", type: "logic.condition", config: { branches: [{ id: "a", condition: { left: { ref: "input.prompt" }, operator: "regex", right: { literal: "[" } } }, { id: "else" }] } }, { id: "output", type: "output.markdown", config: {} }], edges: [{ from: "input", to: "if", mapping: [{ source: "prompt", target: "prompt" }] }, { from: "if", sourcePort: "a", to: "output", mapping: [{ source: "input.prompt", target: "output" }] }, { from: "if", sourcePort: "else", to: "output", mapping: [{ source: "input.prompt", target: "output" }] }] } })).rejects.toMatchObject({ path: "spec.nodes[1].config.branches[0].condition.right.literal" });
  });

  test("orders a selected branch before its join and leaves its sibling control edge inactive", async () => {
    const agent = (id: string) => ({ id, type: "task.agent" as const, config: { systemPrompt: id, skillVersionRefs: [], mcpServerVersionRefs: [], providerBindingRef: "fake-default", agentVersionRef: null } });
    const definition = (await compileWorkflowDefinition({ apiVersion: "workflow/v1alpha1", kind: "Workflow", metadata: { name: "branches" }, spec: { nodes: [{ id: "input", type: "input.prompt", config: {} }, { id: "if", type: "logic.condition", config: { branches: [{ id: "a", condition }, { id: "else" }] } }, agent("a"), agent("b"), { id: "result", type: "output.markdown", config: {} }], edges: [{ from: "input", to: "if", mapping: [{ source: "prompt", target: "prompt" }] }, { from: "if", sourcePort: "a", to: "a", mapping: [{ source: "input.prompt", target: "prompt" }] }, { from: "if", sourcePort: "else", to: "b", mapping: [{ source: "input.prompt", target: "prompt" }] }, { from: "a", to: "result", mapping: [{ source: "output", target: "output" }] }, { from: "b", to: "result", mapping: [{ source: "output", target: "output" }] }] } })).definition;
    expect(topologicalNodes(definition).map((node) => node.id)).toEqual(["input", "if", "a", "b", "result"]);
    const edge = definition.spec.edges[1];
    const conditionNode = definition.spec.nodes[1] as Extract<WorkflowNode, { type: "logic.condition" }>;
    expect(edgeIsSelected(edge, conditionNode, "a")).toBe(true);
    expect(edgeIsSelected(definition.spec.edges[2], conditionNode, "a")).toBe(false);
  });

  test("waits for both inputs at a DAG join and maps nested source data without coercion", () => {
    const definition: WorkflowDefinition = {
      apiVersion: "workflow/v1alpha1",
      kind: "Workflow",
      metadata: { name: "join" },
      spec: {
        nodes: [
          { id: "prompt", type: "input.prompt", config: {} },
          { id: "left", type: "output.markdown", config: {} },
          { id: "right", type: "output.markdown", config: {} },
          { id: "join", type: "output.markdown", config: {} },
        ],
        edges: [
          { from: "prompt", to: "left", mapping: [{ source: "prompt", target: "output" }] },
          { from: "prompt", to: "right", mapping: [{ source: "prompt", target: "output" }] },
          { from: "left", to: "join", mapping: [{ source: "output.markdown", target: "output" }] },
          { from: "right", to: "join", mapping: [{ source: "result.answer", target: "output" }] },
        ],
      },
    };

    const ordered = topologicalNodes(definition).map((node) => node.id);
    expect(ordered.indexOf("join")).toBeGreaterThan(ordered.indexOf("left"));
    expect(ordered.indexOf("join")).toBeGreaterThan(ordered.indexOf("right"));
    expect(readValue("output.markdown", { output: { markdown: "left" } })).toBe("left");
    expect(readValue("result.answer", { result: { answer: false } })).toBe(false);
  });
});
