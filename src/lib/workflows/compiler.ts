import { createHash } from "node:crypto";
import { Type } from "typebox";
import { Check } from "typebox/value";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

export interface WorkflowDefinition extends JsonObject {
  apiVersion: "oncall.workflow/v1alpha1";
  kind: "Workflow";
  metadata: { name: string };
  spec: {
    nodes: Array<{
      id: string;
      type: "input.prompt" | "process.agent" | "output.markdown";
      config: JsonObject;
    }>;
    edges: Array<{
      from: string;
      to: string;
      mapping: Array<{ from: string; to: string }>;
    }>;
  };
}

export interface CompilerDependencies {
  agentVersionExists(reference: string): Promise<boolean>;
  providerBindingExists(alias: string): Promise<boolean>;
}

export class WorkflowValidationError extends Error {
  readonly code = "validation_error";

  constructor(
    readonly path: string,
    readonly nodeId: string | null,
  ) {
    super(`Invalid workflow definition at ${path || "document"}`);
    this.name = "WorkflowValidationError";
  }
}

const EmptyConfigSchema = Type.Object({}, { additionalProperties: false });
const InputNodeSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: Type.Literal("input.prompt"),
  config: EmptyConfigSchema,
}, { additionalProperties: false });
const AgentNodeSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: Type.Literal("process.agent"),
  config: Type.Object({
    agentVersionRef: Type.String({ minLength: 1 }),
    providerBindingRef: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });
const OutputNodeSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: Type.Literal("output.markdown"),
  config: EmptyConfigSchema,
}, { additionalProperties: false });
const MappingSchema = Type.Object({
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
const EdgeSchema = Type.Object({
  from: Type.String({ minLength: 1 }),
  to: Type.String({ minLength: 1 }),
  mapping: Type.Array(MappingSchema, { minItems: 1, maxItems: 1 }),
}, { additionalProperties: false });

export const WorkflowDefinitionSchema = Type.Object({
  apiVersion: Type.Literal("oncall.workflow/v1alpha1"),
  kind: Type.Literal("Workflow"),
  metadata: Type.Object({
    name: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  spec: Type.Object({
    nodes: Type.Array(Type.Union([
      InputNodeSchema,
      AgentNodeSchema,
      OutputNodeSchema,
    ]), { minItems: 3, maxItems: 3 }),
    edges: Type.Array(EdgeSchema, { minItems: 2, maxItems: 2 }),
  }, { additionalProperties: false }),
}, { additionalProperties: false });

function invalid(path: string, nodeId: string | null = null): never {
  throw new WorkflowValidationError(path, nodeId);
}

function record(value: unknown, path: string, nodeId: string | null = null): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, nodeId);
  }
  return value as Record<string, unknown>;
}

function validateObject(
  value: unknown,
  path: string,
  required: readonly string[],
  allowed: readonly string[],
  nodeId: string | null = null,
) {
  const object = record(value, path, nodeId);
  for (const key of required) {
    if (!Object.hasOwn(object, key)) {
      invalid(path ? `${path}.${key}` : key, nodeId);
    }
  }
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      invalid(path ? `${path}.${key}` : key, nodeId);
    }
  }
  return object;
}

function nonEmptyString(value: unknown, path: string, nodeId: string | null = null): string {
  if (typeof value !== "string" || value.length === 0) {
    invalid(path, nodeId);
  }
  return value;
}

function validateStructure(value: unknown): WorkflowDefinition {
  const definition = validateObject(value, "", ["apiVersion", "kind", "metadata", "spec"], ["apiVersion", "kind", "metadata", "spec"]);
  if (definition.apiVersion !== "oncall.workflow/v1alpha1") invalid("apiVersion");
  if (definition.kind !== "Workflow") invalid("kind");

  const metadata = validateObject(definition.metadata, "metadata", ["name"], ["name"]);
  nonEmptyString(metadata.name, "metadata.name");

  const spec = validateObject(definition.spec, "spec", ["nodes", "edges"], ["nodes", "edges"]);
  if (!Array.isArray(spec.nodes) || spec.nodes.length !== 3) invalid("spec.nodes");
  if (!Array.isArray(spec.edges) || spec.edges.length !== 2) invalid("spec.edges");

  for (const [index, rawNode] of spec.nodes.entries()) {
    const basePath = `spec.nodes[${index}]`;
    const possibleNode = record(rawNode, basePath);
    const nodeId = typeof possibleNode.id === "string" && possibleNode.id.length > 0
      ? possibleNode.id
      : null;
    const node = validateObject(rawNode, basePath, ["id", "type", "config"], ["id", "type", "config"], nodeId);
    nonEmptyString(node.id, `${basePath}.id`);
    if (!["input.prompt", "process.agent", "output.markdown"].includes(String(node.type))) {
      invalid(`${basePath}.type`, nodeId);
    }
    const configPath = `${basePath}.config`;
    if (node.type === "process.agent") {
      const config = validateObject(
        node.config,
        configPath,
        ["agentVersionRef", "providerBindingRef"],
        ["agentVersionRef", "providerBindingRef"],
        nodeId,
      );
      nonEmptyString(config.agentVersionRef, `${configPath}.agentVersionRef`, nodeId);
      nonEmptyString(config.providerBindingRef, `${configPath}.providerBindingRef`, nodeId);
    } else {
      validateObject(node.config, configPath, [], [], nodeId);
    }
  }

  for (const [edgeIndex, rawEdge] of spec.edges.entries()) {
    const basePath = `spec.edges[${edgeIndex}]`;
    const edge = validateObject(rawEdge, basePath, ["from", "to", "mapping"], ["from", "to", "mapping"]);
    nonEmptyString(edge.from, `${basePath}.from`);
    nonEmptyString(edge.to, `${basePath}.to`);
    if (!Array.isArray(edge.mapping) || edge.mapping.length !== 1) invalid(`${basePath}.mapping`);
    const mappingPath = `${basePath}.mapping[0]`;
    const mapping = validateObject(edge.mapping[0], mappingPath, ["from", "to"], ["from", "to"]);
    nonEmptyString(mapping.from, `${mappingPath}.from`);
    nonEmptyString(mapping.to, `${mappingPath}.to`);
  }

  if (!Check(WorkflowDefinitionSchema, value)) invalid("");
  return value as WorkflowDefinition;
}

function validateGraph(definition: WorkflowDefinition) {
  const nodes = definition.spec.nodes;
  const nodeById = new Map<string, WorkflowDefinition["spec"]["nodes"][number]>();
  for (const [index, node] of nodes.entries()) {
    if (nodeById.has(node.id)) invalid(`spec.nodes[${index}].id`, node.id);
    nodeById.set(node.id, node);
  }

  for (const [index, edge] of definition.spec.edges.entries()) {
    if (!nodeById.has(edge.from)) invalid(`spec.edges[${index}].from`);
    if (!nodeById.has(edge.to)) invalid(`spec.edges[${index}].to`);
  }

  const inputNodes = nodes.filter((node) => node.type === "input.prompt");
  const agentNodes = nodes.filter((node) => node.type === "process.agent");
  const outputNodes = nodes.filter((node) => node.type === "output.markdown");
  if (inputNodes.length !== 1 || agentNodes.length !== 1 || outputNodes.length !== 1) {
    invalid("spec.nodes");
  }

  const input = inputNodes[0];
  const agent = agentNodes[0];
  const output = outputNodes[0];
  const expectedMapping = (edge: WorkflowDefinition["spec"]["edges"][number]) => {
    if (edge.from === input.id && edge.to === agent.id) return { from: "prompt", to: "prompt" };
    if (edge.from === agent.id && edge.to === output.id) return { from: "markdown", to: "markdown" };
    return null;
  };
  if (definition.spec.edges.some((edge) => expectedMapping(edge) === null)) invalid("spec.edges");
  if (definition.spec.edges.filter((edge) => edge.from === input.id && edge.to === agent.id).length !== 1) {
    invalid("spec.edges");
  }

  for (const [index, edge] of definition.spec.edges.entries()) {
    const expected = expectedMapping(edge)!;
    if (edge.mapping[0].from !== expected.from) {
      invalid(`spec.edges[${index}].mapping[0].from`);
    }
    if (edge.mapping[0].to !== expected.to) {
      invalid(`spec.edges[${index}].mapping[0].to`);
    }
  }
}

function compareUnicodeCodePoints(left: string, right: string) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function canonicalizeJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareUnicodeCodePoints)
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Value is not JSON serializable");
  return serialized;
}

export async function compileWorkflowDefinition(
  value: unknown,
  dependencies: CompilerDependencies,
) {
  const definition = validateStructure(value);
  validateGraph(definition);
  const agentNodeIndex = definition.spec.nodes.findIndex((node) => node.type === "process.agent");
  const agentNode = definition.spec.nodes[agentNodeIndex];
  const config = agentNode.config as {
    agentVersionRef: string;
    providerBindingRef: string;
  };
  if (!await dependencies.agentVersionExists(config.agentVersionRef)) {
    invalid(`spec.nodes[${agentNodeIndex}].config.agentVersionRef`, agentNode.id);
  }
  if (!await dependencies.providerBindingExists(config.providerBindingRef)) {
    invalid(`spec.nodes[${agentNodeIndex}].config.providerBindingRef`, agentNode.id);
  }

  const canonicalJson = canonicalizeJson(definition);
  return {
    definition: JSON.parse(canonicalJson) as WorkflowDefinition,
    canonicalJson,
    hash: createHash("sha256").update(canonicalJson, "utf8").digest("hex"),
  };
}
