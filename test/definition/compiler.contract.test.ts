import { describe, expect, test } from "vitest";
import { compileWorkflowDefinition, evaluateCondition } from "../../src/lib/workflows/compiler";
import type { WorkflowDefinition, WorkflowNode } from "../../src/lib/workflows/contracts";

function definition(): WorkflowDefinition {
  return {
    apiVersion: "workflow/v1alpha1",
    kind: "Workflow",
    metadata: { name: "conditional workflow" },
    spec: {
      nodes: [
        { id: "prompt", type: "input.prompt", config: {} },
        {
          id: "route",
          type: "logic.condition",
          config: {
            branches: [
              {
                id: "if-a",
                condition: {
                  type: "group",
                  group: "and",
                  children: [
                    { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "A" } },
                    {
                      type: "group",
                      group: "or",
                      children: [
                        { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "route" } },
                        { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "alpha" } },
                      ],
                    },
                  ],
                },
              },
              { id: "else-if-b", condition: { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "B" } } },
              { id: "else" },
            ],
          },
        },
        { id: "agent-a", type: "task.agent", config: { systemPrompt: "A", skillVersionRefs: ["skill-version-a"], mcpServerVersionRefs: ["mcp-version-a"], providerBindingRef: "fake-default", agentVersionRef: null } },
        { id: "agent-b", type: "task.agent", config: { systemPrompt: "B", skillVersionRefs: ["skill-version-b"], mcpServerVersionRefs: ["mcp-version-b"], providerBindingRef: "fake-default", agentVersionRef: null } },
        { id: "result", type: "output.markdown", config: {} },
      ],
      edges: [
        { from: "prompt", to: "route", mapping: [{ source: "prompt", target: "prompt" }] },
        { from: "route", sourcePort: "if-a", to: "agent-a", mapping: [{ source: "input.prompt", target: "prompt" }] },
        { from: "route", sourcePort: "else-if-b", to: "agent-b", mapping: [{ source: "input.prompt", target: "prompt" }] },
        { from: "route", sourcePort: "else", to: "agent-b", mapping: [{ source: "input.prompt", target: "prompt" }] },
        { from: "agent-a", to: "result", mapping: [{ source: "output", target: "output" }] },
        { from: "agent-b", to: "result", mapping: [{ source: "output", target: "output" }] },
      ],
    },
  };
}

describe("workflow/v1alpha1 compiler", () => {
  test("accepts nested AND/OR conditions, ordered branches, and versioned resource references", async () => {
    const compiled = await compileWorkflowDefinition(definition(), {
      providerBindingExists: async (reference) => reference === "fake-default",
      skillVersionExists: async (reference) => reference.startsWith("skill-version-"),
      mcpServerVersionExists: async (reference) => reference.startsWith("mcp-version-"),
    });

    expect(compiled.definition).toEqual(definition());
    expect(compiled.hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("normalizes legacy inline agents and validates an explicit agent version reference", async () => {
    const legacy = structuredClone(definition()) as any;
    delete legacy.spec.nodes[2].config.agentVersionRef;
    const inline = await compileWorkflowDefinition(legacy);
    expect(inline.definition.spec.nodes[2]).toMatchObject({ config: { agentVersionRef: null } });

    const referenced = definition();
    const agent = referenced.spec.nodes.find((node): node is Extract<WorkflowNode, { type: "task.agent" }> => node.id === "agent-a");
    if (!agent) throw new Error("Agent node missing");
    agent.config.agentVersionRef = "agent-version-a";
    await expect(compileWorkflowDefinition(referenced, { agentVersionExists: async (ref) => ref === "agent-version-a" })).resolves.toBeDefined();
    await expect(compileWorkflowDefinition(referenced, { agentVersionExists: async () => false })).rejects.toMatchObject({ path: "spec.nodes[2].config.agentVersionRef", nodeId: "agent-a" });
  });

  test("rejects a condition without its final Else fallback", async () => {
    const value = definition();
    const route = value.spec.nodes.find((node): node is Extract<WorkflowNode, { type: "logic.condition" }> => node.id === "route");
    if (!route) throw new Error("Condition node missing");
    route.config.branches.pop();

    await expect(compileWorkflowDefinition(value)).rejects.toMatchObject({
      code: "validation_error",
      path: "spec.nodes[1].config.branches",
      nodeId: "route",
    });
  });

  test("rejects condition references to a downstream node", async () => {
    const value = definition();
    const route = value.spec.nodes.find((node): node is Extract<WorkflowNode, { type: "logic.condition" }> => node.id === "route");
    if (!route || !route.config.branches[0].condition) throw new Error("Condition node missing");
    route.config.branches[0].condition = { left: { ref: "agent-a.output" }, operator: "contains", right: { literal: "A" } };

    await expect(compileWorkflowDefinition(value)).rejects.toMatchObject({
      code: "validation_error",
      path: "spec.nodes[1].config.branches[0].condition.left.ref",
      nodeId: "route",
    });
  });

  test("rejects branch mappings that reference a downstream node", async () => {
    const value = definition();
    const edge = value.spec.edges.find((candidate) => candidate.from === "route" && candidate.sourcePort === "if-a");
    if (!edge) throw new Error("Condition edge missing");
    edge.mapping[0].source = "agent-a.output";

    await expect(compileWorkflowDefinition(value)).rejects.toMatchObject({
      code: "validation_error",
      path: "spec.edges[1].mapping[0].source",
      nodeId: "route",
    });
  });

  test("rejects disconnected nodes", async () => {
    const disconnected = definition();
    disconnected.spec.nodes.push({ id: "orphan", type: "task.agent", config: { systemPrompt: "orphan", skillVersionRefs: [], mcpServerVersionRefs: [], providerBindingRef: "fake-default", agentVersionRef: null } });
    await expect(compileWorkflowDefinition(disconnected)).rejects.toMatchObject({ path: "spec.edges" });
  });

  test("accepts distinct terminal Markdown outputs for condition branches", async () => {
    const value: WorkflowDefinition = {
      apiVersion: "workflow/v1alpha1",
      kind: "Workflow",
      metadata: { name: "branch outputs" },
      spec: {
        nodes: [
          { id: "prompt", type: "input.prompt", config: {} },
          { id: "route", type: "logic.condition", config: { branches: [{ id: "match", condition: { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "match" } } }, { id: "else" }] } },
          { id: "matched", type: "output.markdown", config: {} },
          { id: "fallback", type: "output.markdown", config: {} },
        ],
        edges: [
          { from: "prompt", to: "route", mapping: [{ source: "prompt", target: "prompt" }] },
          { from: "route", sourcePort: "match", to: "matched", mapping: [{ source: "input.prompt", target: "output" }] },
          { from: "route", sourcePort: "else", to: "fallback", mapping: [{ source: "input.prompt", target: "output" }] },
        ],
      },
    };

    await expect(compileWorkflowDefinition(value)).resolves.toMatchObject({ definition: value });
  });

  test("rejects parallel non-Condition paths that could execute two Markdown outputs", async () => {
    const value: WorkflowDefinition = {
      apiVersion: "workflow/v1alpha1",
      kind: "Workflow",
      metadata: { name: "parallel outputs" },
      spec: {
        nodes: [
          { id: "prompt", type: "input.prompt", config: {} },
          { id: "agent", type: "task.agent", config: { systemPrompt: "respond", skillVersionRefs: [], mcpServerVersionRefs: [], providerBindingRef: "fake-default", agentVersionRef: null } },
          { id: "first", type: "output.markdown", config: {} },
          { id: "second", type: "output.markdown", config: {} },
        ],
        edges: [
          { from: "prompt", to: "agent", mapping: [{ source: "prompt", target: "prompt" }] },
          { from: "agent", to: "first", mapping: [{ source: "output", target: "output" }] },
          { from: "agent", to: "second", mapping: [{ source: "output", target: "output" }] },
        ],
      },
    };

    await expect(compileWorkflowDefinition(value)).rejects.toMatchObject({
      code: "validation_error",
      path: "spec.edges",
    });
  });

  test("requires exactly one Input and at least one Markdown output", async () => {
    const duplicateInput = definition();
    duplicateInput.spec.nodes.push({ id: "prompt-2", type: "input.prompt", config: {} });
    await expect(compileWorkflowDefinition(duplicateInput)).rejects.toMatchObject({ path: "spec.nodes" });

    const noOutput = definition();
    noOutput.spec.nodes = noOutput.spec.nodes.filter((node) => node.type !== "output.markdown");
    noOutput.spec.edges = noOutput.spec.edges.filter((edge) => edge.to !== "result");
    await expect(compileWorkflowDefinition(noOutput)).rejects.toMatchObject({ path: "spec.nodes" });
  });

  test("rejects any reachable terminal path that does not end at a Markdown output", async () => {
    const value = definition();
    value.spec.edges = value.spec.edges.filter((edge) => edge.sourcePort !== "else");

    await expect(compileWorkflowDefinition(value)).rejects.toMatchObject({ path: "spec.edges" });
  });

  test("rejects Markdown outputs with outgoing edges", async () => {
    const value = definition();
    value.spec.nodes.push({ id: "after-output", type: "task.agent", config: { systemPrompt: "after", skillVersionRefs: [], mcpServerVersionRefs: [], providerBindingRef: "fake-default", agentVersionRef: null } });
    value.spec.edges.push({ from: "result", to: "after-output", mapping: [{ source: "markdown", target: "prompt" }] });

    await expect(compileWorkflowDefinition(value)).rejects.toMatchObject({ path: "spec.edges[6].from", nodeId: "result" });
  });

  test("evaluates nested AND/OR conditions without coercion", () => {
    const route = definition().spec.nodes.find((node): node is Extract<WorkflowNode, { type: "logic.condition" }> => node.id === "route");
    const expression = route?.config.branches[0]?.condition;
    if (!expression) throw new Error("Condition expression missing");

    expect(evaluateCondition(expression, { "input.prompt": "route A" })).toBe(true);
    expect(evaluateCondition(expression, { "input.prompt": "A only" })).toBe(false);
    expect(evaluateCondition(expression, { "input.prompt": "route B" })).toBe(false);
  });
});
