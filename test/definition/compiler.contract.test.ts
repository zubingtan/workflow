import { describe, expect, test } from "vitest";
import {
  canonical,
  canonicalize,
  compile,
  mutate,
  validDefinition,
  validationError,
} from "./helpers";

describe("M0-T03/T04 compiler", () => {
  test("accepts only the fixed three-node chain and typed mappings", async () => {
    await compile(validDefinition());
  });

  test.each([
    ["apiVersion", (value: any) => delete value.apiVersion, null],
    ["kind", (value: any) => delete value.kind, null],
    ["metadata", (value: any) => delete value.metadata, null],
    ["metadata.name", (value: any) => delete value.metadata.name, null],
    ["spec", (value: any) => delete value.spec, null],
    ["spec.nodes", (value: any) => delete value.spec.nodes, null],
    ["spec.edges", (value: any) => delete value.spec.edges, null],
    ["spec.nodes[1].id", (value: any) => delete value.spec.nodes[1].id, null],
    ["spec.nodes[1].type", (value: any) => delete value.spec.nodes[1].type, "analyze"],
    ["spec.nodes[1].config", (value: any) => delete value.spec.nodes[1].config, "analyze"],
    ["spec.nodes[1].config.agentVersionRef", (value: any) => delete value.spec.nodes[1].config.agentVersionRef, "analyze"],
    ["spec.nodes[1].config.providerBindingRef", (value: any) => delete value.spec.nodes[1].config.providerBindingRef, "analyze"],
    ["spec.edges[0].from", (value: any) => delete value.spec.edges[0].from, null],
    ["spec.edges[0].to", (value: any) => delete value.spec.edges[0].to, null],
    ["spec.edges[0].mapping", (value: any) => delete value.spec.edges[0].mapping, null],
    ["spec.edges[0].mapping[0].from", (value: any) => delete value.spec.edges[0].mapping[0].from, null],
    ["spec.edges[0].mapping[0].to", (value: any) => delete value.spec.edges[0].mapping[0].to, null],
  ])("rejects missing required field %s", async (path, change, nodeId) => {
    const error = await validationError(mutate(change));
    expect(error).toMatchObject({ code: "validation_error", path, nodeId });
  });

  test.each(["agentVersionRef", "providerBindingRef"])(
    "rejects empty process.agent reference %s",
    async (field) => {
      const error = await validationError(mutate((definition) => {
        definition.spec.nodes[1].config[field] = "";
      }));
      expect(error).toMatchObject({
        code: "validation_error",
        path: `spec.nodes[1].config.${field}`,
        nodeId: "analyze",
      });
    },
  );

  test.each([
    ["too few nodes", (value: any) => value.spec.nodes.pop(), "spec.nodes"],
    ["too many nodes", (value: any) => value.spec.nodes.push({ id: "extra", type: "output.markdown", config: {} }), "spec.nodes"],
    ["too few edges", (value: any) => value.spec.edges.pop(), "spec.edges"],
    ["too many edges", (value: any) => value.spec.edges.push(structuredClone(value.spec.edges[1])), "spec.edges"],
    ["missing mapping", (value: any) => value.spec.edges[0].mapping.pop(), "spec.edges[0].mapping"],
    ["extra mapping", (value: any) => value.spec.edges[0].mapping.push({ from: "prompt", to: "prompt" }), "spec.edges[0].mapping"],
  ])("rejects %s", async (_label, change, path) => {
    const error = await validationError(mutate(change));
    expect(error).toMatchObject({ code: "validation_error", path, nodeId: null });
  });

  test("canonical JSON orders object keys by Unicode code point, not UTF-16 code unit", async () => {
    const privateUse = "\uE000";
    const nonBmp = "\u{10000}";
    const value = { [nonBmp]: "non-bmp", [privateUse]: "private-use" };

    expect(Object.keys(value).sort()).toEqual([nonBmp, privateUse]);
    expect(canonical(value)).toBe(`{"${privateUse}":"private-use","${nonBmp}":"non-bmp"}`);
    await expect(canonicalize(value)).resolves.toBe(canonical(value));
  });

  test.each([
    ["apiVersion", (value: any) => (value.apiVersion = "workflow/v1")],
    ["kind", (value: any) => (value.kind = "Pipeline")],
    ["metadata.name", (value: any) => (value.metadata.name = "")],
    ["unexpected", (value: any) => (value.unexpected = true)],
    ["metadata.owner", (value: any) => (value.metadata.owner = "oncall")],
    ["spec.extra", (value: any) => (value.spec.extra = true)],
    ["spec.nodes[1].label", (value: any) => (value.spec.nodes[1].label = "Agent")],
    ["spec.edges[0].condition", (value: any) => (value.spec.edges[0].condition = "always")],
    ["spec.edges[0].mapping[0].transform", (value: any) => (value.spec.edges[0].mapping[0].transform = "identity")],
  ])("rejects closed-schema defect at %s", async (path, change) => {
    const error = await validationError(mutate(change));
    expect(error).toMatchObject({ code: "validation_error", path });
    expect(error.message).not.toHaveLength(0);
  });

  test.each(["provider", "baseUrl", "apiKey", "apiKeyEnv", "model", "params", "parameters"])(
    "rejects process.agent runtime override %s",
    async (field) => {
      const error = await validationError(mutate((value) => {
        value.spec.nodes[1].config[field] = "forbidden";
      }));
      expect(error).toMatchObject({
        code: "validation_error",
        path: `spec.nodes[1].config.${field}`,
        nodeId: "analyze",
      });
    },
  );

  test.each([
    ["duplicate IDs", (value: any) => (value.spec.nodes[2].id = "analyze"), /^spec\.nodes\[\d+\]\.id$/, "analyze"],
    ["unsupported types", (value: any) => (value.spec.nodes[1].type = "process.code"), /^spec\.nodes\[1\]\.type$/, "analyze"],
    ["dangling references", (value: any) => (value.spec.edges[0].to = "missing"), /^spec\.edges\[0\]\.to$/, null],
    ["unreachable nodes", (value: any) => value.spec.edges.pop(), /^spec\.(edges|nodes)/, null],
    ["cycles", (value: any) => { value.spec.edges[1].to = "prompt"; value.spec.edges[1].mapping[0].to = "prompt"; }, /^spec\.(edges|nodes)/, null],
    ["multiple starts", (value: any) => (value.spec.edges[0].from = "analyze"), /^spec\.(edges|nodes)/, null],
    ["multiple ends", (value: any) => (value.spec.edges[1].from = "prompt"), /^spec\.(edges|nodes)/, null],
    ["source-port incompatibility", (value: any) => (value.spec.edges[0].mapping[0].from = "markdown"), /^spec\.edges\[0\]\.mapping\[0\]\.from$/, null],
    ["target-port incompatibility", (value: any) => (value.spec.edges[1].mapping[0].to = "prompt"), /^spec\.edges\[1\]\.mapping\[0\]\.to$/, null],
  ])("rejects %s from one conceptual graph defect", async (_label, change, path, nodeId) => {
    const error = await validationError(mutate(change));
    expect(error.code).toBe("validation_error");
    expect(error.path).toMatch(path);
    expect(error.nodeId).toBe(nodeId);
  });

  test.each([
    ["agentVersionRef", "missing-agent-v1"],
    ["providerBindingRef", "missing-binding"],
  ])("reports exact missing %s field and node", async (field, value) => {
    const error = await validationError(mutate((definition) => {
      definition.spec.nodes[1].config[field] = value;
    }));
    expect(error).toMatchObject({
      code: "validation_error",
      path: `spec.nodes[1].config.${field}`,
      nodeId: "analyze",
    });
  });
});
