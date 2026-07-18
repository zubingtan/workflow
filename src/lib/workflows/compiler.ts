import { createHash } from "node:crypto";
import type {
  ConditionClause,
  ConditionExpression,
  JsonValue,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from "./contracts";

export type { ConditionExpression, JsonValue, WorkflowDefinition } from "./contracts";

export interface CompilerDependencies {
  agentVersionExists?(reference: string): Promise<boolean>;
  skillVersionExists?(reference: string): Promise<boolean>;
  mcpServerVersionExists?(reference: string): Promise<boolean>;
  providerBindingExists?(alias: string): Promise<boolean>;
}

export class WorkflowValidationError extends Error {
  readonly code = "validation_error";
  constructor(readonly path: string, readonly nodeId: string | null = null) {
    super(`Invalid workflow definition at ${path || "document"}`);
    this.name = "WorkflowValidationError";
  }
}

const nodeTypes = new Set(["input.prompt", "task.agent", "logic.condition", "output.markdown"]);
const json = (value: unknown): value is JsonValue => value === null || ["string", "boolean", "number"].includes(typeof value)
  || (Array.isArray(value) && value.every(json))
  || (!!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(json));
function invalid(path: string, nodeId: string | null = null): never { throw new WorkflowValidationError(path, nodeId); }
function object(value: unknown, path: string, nodeId: string | null = null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path, nodeId);
  return value as Record<string, unknown>;
}
function exact(value: unknown, path: string, required: string[], allowed: string[], nodeId: string | null = null) {
  const result = object(value, path, nodeId);
  for (const key of required) if (!(key in result)) invalid(`${path}${path ? "." : ""}${key}`, nodeId);
  for (const key of Object.keys(result)) if (!allowed.includes(key)) invalid(`${path}${path ? "." : ""}${key}`, nodeId);
  return result;
}
function text(value: unknown, path: string, nodeId: string | null = null) {
  if (typeof value !== "string" || value.length === 0) invalid(path, nodeId);
  return value;
}

function validateOperand(value: unknown, path: string, nodeId: string): void {
  const operand = object(value, path, nodeId);
  if (Object.keys(operand).length !== 1) invalid(path, nodeId);
  if ("ref" in operand) { text(operand.ref, `${path}.ref`, nodeId); return; }
  if ("literal" in operand && json(operand.literal)) return;
  invalid(path, nodeId);
}

export function validateCondition(value: unknown, path: string, nodeId: string): ConditionExpression {
  const expression = object(value, path, nodeId);
  const isGroup = expression.type === "group" || "group" in expression;
  if (isGroup) {
    exact(expression, path, ["group", "children"], ["type", "group", "children"], nodeId);
    if (expression.type !== undefined && expression.type !== "group") invalid(`${path}.type`, nodeId);
    if (expression.group !== "and" && expression.group !== "or") invalid(`${path}.group`, nodeId);
    if (!Array.isArray(expression.children) || expression.children.length === 0) invalid(`${path}.children`, nodeId);
    expression.children.forEach((child, index) => validateCondition(child, `${path}.children[${index}]`, nodeId));
    return expression as unknown as ConditionExpression;
  }
  exact(expression, path, ["left", "operator", "right"], ["type", "left", "operator", "right"], nodeId);
  if (expression.type !== undefined && expression.type !== "clause") invalid(`${path}.type`, nodeId);
  if (!["strict_equals", "contains", "regex"].includes(String(expression.operator))) invalid(`${path}.operator`, nodeId);
  const left = exact(expression.left, `${path}.left`, ["ref"], ["ref"], nodeId);
  text(left.ref, `${path}.left.ref`, nodeId);
  validateOperand(expression.right, `${path}.right`, nodeId);
  if (expression.operator === "regex" && "literal" in object(expression.right, `${path}.right`, nodeId)) {
    const literal = object(expression.right, `${path}.right`, nodeId).literal;
    if (typeof literal !== "string") invalid(`${path}.right.literal`, nodeId);
    try { new RegExp(literal); } catch { invalid(`${path}.right.literal`, nodeId); }
  }
  return expression as unknown as ConditionClause;
}

function validateNode(value: unknown, path: string): WorkflowNode {
  const maybe = object(value, path);
  const id = typeof maybe.id === "string" && maybe.id ? maybe.id : null;
  const node = exact(value, path, ["id", "type", "config"], ["id", "type", "config"], id);
  const nodeId = text(node.id, `${path}.id`, id);
  if (!nodeTypes.has(String(node.type))) invalid(`${path}.type`, id);
  if (node.type === "task.agent") {
    const config = exact(node.config, `${path}.config`, ["systemPrompt", "skillVersionRefs", "mcpServerVersionRefs", "providerBindingRef"], ["systemPrompt", "skillVersionRefs", "mcpServerVersionRefs", "providerBindingRef", "agentVersionRef"], id);
    text(config.systemPrompt, `${path}.config.systemPrompt`, id);
    text(config.providerBindingRef, `${path}.config.providerBindingRef`, id);
    if (config.agentVersionRef !== undefined && config.agentVersionRef !== null && (typeof config.agentVersionRef !== "string" || !config.agentVersionRef)) invalid(`${path}.config.agentVersionRef`, id);
    for (const field of ["skillVersionRefs", "mcpServerVersionRefs"] as const) {
      if (!Array.isArray(config[field]) || !config[field].every((item) => typeof item === "string" && item.length > 0)) invalid(`${path}.config.${field}`, id);
    }
  } else if (node.type === "logic.condition") {
    const config = exact(node.config, `${path}.config`, ["branches"], ["branches"], id);
    if (!Array.isArray(config.branches) || config.branches.length < 2) invalid(`${path}.config.branches`, id);
    const branches = config.branches as unknown[];
    let fallback = false;
    const ids = new Set<string>();
    branches.forEach((raw, index) => {
      const branch = exact(raw, `${path}.config.branches[${index}]`, ["id"], ["id", "condition"], id);
      const branchId = text(branch.id, `${path}.config.branches[${index}].id`, id);
      if (ids.has(branchId)) invalid(`${path}.config.branches[${index}].id`, id);
      ids.add(branchId);
      if (branch.condition === undefined) { if (fallback || index !== branches.length - 1) invalid(`${path}.config.branches[${index}].condition`, nodeId); fallback = true; }
      else { if (fallback) invalid(`${path}.config.branches[${index}].condition`, nodeId); validateCondition(branch.condition, `${path}.config.branches[${index}].condition`, nodeId); }
    });
    if (!fallback) invalid(`${path}.config.branches`, id);
  } else exact(node.config, `${path}.config`, [], [], id);
  if (node.type === "task.agent") return { ...node, config: { ...node.config as Record<string, unknown>, agentVersionRef: node.config && typeof node.config === "object" && "agentVersionRef" in node.config ? (node.config as Record<string, unknown>).agentVersionRef : null } } as unknown as WorkflowNode;
  return node as unknown as WorkflowNode;
}

function validateEdge(value: unknown, path: string): WorkflowEdge {
  const edge = exact(value, path, ["from", "to", "mapping"], ["from", "to", "sourcePort", "targetPort", "fromPort", "toPort", "mapping"]);
  text(edge.from, `${path}.from`); text(edge.to, `${path}.to`);
  if (edge.sourcePort !== undefined && edge.fromPort !== undefined) invalid(`${path}.sourcePort`);
  if (edge.targetPort !== undefined && edge.toPort !== undefined) invalid(`${path}.targetPort`);
  const sourcePort = edge.sourcePort === undefined && edge.fromPort === undefined ? undefined : text(edge.sourcePort ?? edge.fromPort, `${path}.${edge.sourcePort === undefined ? "fromPort" : "sourcePort"}`);
  const targetPort = edge.targetPort === undefined && edge.toPort === undefined ? undefined : text(edge.targetPort ?? edge.toPort, `${path}.${edge.targetPort === undefined ? "toPort" : "targetPort"}`);
  if (!Array.isArray(edge.mapping)) invalid(`${path}.mapping`);
  const mapping = edge.mapping.map((raw, index) => { const item = exact(raw, `${path}.mapping[${index}]`, [], ["source", "target", "from", "to"]); const source = item.source ?? item.from; const target = item.target ?? item.to; if (typeof source !== "string" || !source) invalid(`${path}.mapping[${index}].source`); if (typeof target !== "string" || !target) invalid(`${path}.mapping[${index}].target`); if ((item.source !== undefined && item.from !== undefined) || (item.target !== undefined && item.to !== undefined)) invalid(`${path}.mapping[${index}]`); return { source, target }; });
  return { from: edge.from as string, to: edge.to as string, ...(sourcePort ? { sourcePort } : {}), ...(targetPort ? { targetPort } : {}), mapping };
}

function sourcePorts(node: WorkflowNode) { if (node.type === "input.prompt") return ["prompt"]; if (node.type === "task.agent") return ["output"]; if (node.type === "logic.condition") return node.config.branches.map((branch) => branch.id); return []; }
function targetPorts(node: WorkflowNode) { return node.type === "output.markdown" ? ["output"] : node.type === "input.prompt" ? [] : ["prompt", "output"]; }
function validateGraph(definition: WorkflowDefinition) {
  const nodes = new Map<string, WorkflowNode>();
  definition.spec.nodes.forEach((node, index) => { if (nodes.has(node.id)) invalid(`spec.nodes[${index}].id`, node.id); nodes.set(node.id, node); });
  const inputs = [...nodes.values()].filter((node) => node.type === "input.prompt");
  const outputs = [...nodes.values()].filter((node) => node.type === "output.markdown");
  if (inputs.length !== 1 || outputs.length === 0) invalid("spec.nodes");
  const incoming = new Map<string, number>(); const outgoing = new Map<string, string[]>(); const reverse = new Map<string, string[]>();
  for (const id of nodes.keys()) { incoming.set(id, 0); outgoing.set(id, []); reverse.set(id, []); }
  definition.spec.edges.forEach((edge, index) => {
    const source = nodes.get(edge.from); const target = nodes.get(edge.to);
    if (!source) invalid(`spec.edges[${index}].from`); if (!target) invalid(`spec.edges[${index}].to`);
    if (source!.type === "output.markdown") invalid(`spec.edges[${index}].from`, source!.id);
    if (source!.type === "logic.condition") { if (!edge.sourcePort || !sourcePorts(source!).includes(edge.sourcePort)) invalid(`spec.edges[${index}].sourcePort`); }
    else if (edge.sourcePort !== undefined && !sourcePorts(source!).includes(edge.sourcePort)) invalid(`spec.edges[${index}].sourcePort`);
    if (edge.targetPort !== undefined && !targetPorts(target!).includes(edge.targetPort)) invalid(`spec.edges[${index}].targetPort`);
    edge.mapping.forEach((mapping, mappingIndex) => {
      const dataSources = source!.type === "logic.condition" ? null : sourcePorts(source!);
      if (dataSources && !dataSources.includes(mapping.source)) invalid(`spec.edges[${index}].mapping[${mappingIndex}].source`);
      if (!targetPorts(target!).includes(mapping.target)) invalid(`spec.edges[${index}].mapping[${mappingIndex}].target`);
    });
    incoming.set(target!.id, incoming.get(target!.id)! + 1); outgoing.get(source!.id)!.push(target!.id); reverse.get(target!.id)!.push(source!.id);
  });
  definition.spec.nodes.forEach((node, index) => {
    if (node.type !== "logic.condition") return;
    for (const branch of node.config.branches) {
      if (!definition.spec.edges.some((edge) => edge.from === node.id && edge.sourcePort === branch.id)) invalid("spec.edges", node.id);
    }
  });
  const ready = [...nodes.keys()].filter((id) => incoming.get(id) === 0); let seen = 0;
  while (ready.length) { const id = ready.pop()!; seen += 1; for (const next of outgoing.get(id)!) { incoming.set(next, incoming.get(next)! - 1); if (incoming.get(next) === 0) ready.push(next); } }
  if (seen !== nodes.size) invalid("spec.edges");
  const visit = (start: string, graph: Map<string, string[]>) => {
    const reachable = new Set<string>(); const pending = [start];
    while (pending.length) { const id = pending.pop()!; if (reachable.has(id)) continue; reachable.add(id); pending.push(...graph.get(id)!); }
    return reachable;
  };
  const reachableFromInput = visit(inputs[0].id, outgoing);
  const reachesAnOutput = new Set(outputs.flatMap((node) => [...visit(node.id, reverse)]));
  if (reachableFromInput.size !== nodes.size || reachesAnOutput.size !== nodes.size) invalid("spec.edges");
  for (const nodeId of reachableFromInput) if (outgoing.get(nodeId)!.length === 0 && nodes.get(nodeId)!.type !== "output.markdown") invalid("spec.edges");

  const edgesFrom = new Map<string, WorkflowEdge[]>();
  definition.spec.edges.forEach((edge) => edgesFrom.set(edge.from, [...(edgesFrom.get(edge.from) ?? []), edge]));
  const terminalSignatures = new Map<string, Set<string>>();
  const signature = (nodeId: string): Set<string> => {
    const cached = terminalSignatures.get(nodeId);
    if (cached) return cached;
    const node = nodes.get(nodeId)!;
    if (node.type === "output.markdown") {
      const result = new Set([node.id]);
      terminalSignatures.set(nodeId, result);
      return result;
    }
    const outgoingEdges = edgesFrom.get(nodeId) ?? [];
    if (node.type === "logic.condition") {
      for (const branch of node.config.branches) {
        const branchSignatures = new Set<string>();
        for (const edge of outgoingEdges) if (edge.sourcePort === branch.id) for (const output of signature(edge.to)) branchSignatures.add(output);
        if (branchSignatures.size > 1) invalid("spec.edges", node.id);
      }
      const result = new Set([`condition:${node.id}`]);
      terminalSignatures.set(nodeId, result);
      return result;
    }
    const result = new Set<string>();
    for (const edge of outgoingEdges) for (const output of signature(edge.to)) result.add(output);
    if (result.size > 1) invalid("spec.edges", node.id);
    terminalSignatures.set(nodeId, result);
    return result;
  };
  signature(inputs[0].id);
}

function validateReference(reference: string, path: string, nodeId: string, nodes: Map<string, WorkflowNode>) {
  if (reference === "input.prompt") return;
  const [sourceId, port] = reference.split(".");
  const source = nodes.get(sourceId);
  if (!source || !port || !sourcePorts(source).includes(port)) invalid(path, nodeId);
}

function validateReachableReference(reference: string, path: string, nodeId: string, nodes: Map<string, WorkflowNode>, ancestors: Set<string>, inputId: string) {
  validateReference(reference, path, nodeId, nodes);
  const sourceId = reference === "input.prompt" ? inputId : reference.split(".")[0];
  if (!ancestors.has(sourceId)) invalid(path, nodeId);
}

function validateExpressionReferences(expression: ConditionExpression, path: string, nodeId: string, nodes: Map<string, WorkflowNode>, ancestors: Set<string>, inputId: string): void {
  if ("group" in expression) { expression.children.forEach((child, index) => validateExpressionReferences(child, `${path}.children[${index}]`, nodeId, nodes, ancestors, inputId)); return; }
  validateReachableReference(expression.left.ref, `${path}.left.ref`, nodeId, nodes, ancestors, inputId);
  if ("ref" in expression.right) validateReachableReference(expression.right.ref, `${path}.right.ref`, nodeId, nodes, ancestors, inputId);
}

function validateVariableReferences(definition: WorkflowDefinition) {
  const nodes = new Map(definition.spec.nodes.map((node) => [node.id, node]));
  const input = definition.spec.nodes.find((node) => node.type === "input.prompt");
  if (!input) invalid("spec.nodes");
  const incoming = new Map<string, string[]>();
  for (const id of nodes.keys()) incoming.set(id, []);
  definition.spec.edges.forEach((edge) => incoming.get(edge.to)!.push(edge.from));
  const ancestorsOf = (nodeId: string) => {
    const ancestors = new Set<string>(); const pending = [...incoming.get(nodeId)!];
    while (pending.length) { const id = pending.pop()!; if (ancestors.has(id)) continue; ancestors.add(id); pending.push(...incoming.get(id)!); }
    return ancestors;
  };
  definition.spec.nodes.forEach((node, index) => {
    if (node.type === "logic.condition") node.config.branches.forEach((branch, branchIndex) => {
      if (branch.condition) validateExpressionReferences(branch.condition, `spec.nodes[${index}].config.branches[${branchIndex}].condition`, node.id, nodes, ancestorsOf(node.id), input.id);
    });
  });
  definition.spec.edges.forEach((edge, edgeIndex) => {
    if (nodes.get(edge.from)?.type === "logic.condition") edge.mapping.forEach((mapping, mappingIndex) => validateReachableReference(mapping.source, `spec.edges[${edgeIndex}].mapping[${mappingIndex}].source`, edge.from, nodes, ancestorsOf(edge.from), input.id));
  });
}

export function evaluateCondition(expression: ConditionExpression, values: Record<string, unknown>): boolean {
  if ("group" in expression) return expression.group === "and" ? expression.children.every((child) => evaluateCondition(child, values)) : expression.children.some((child) => evaluateCondition(child, values));
  const resolve = (operand: { ref: string } | { literal: JsonValue }) => "ref" in operand ? values[operand.ref] : operand.literal;
  const left = resolve(expression.left); const right = resolve(expression.right);
  if (expression.operator === "strict_equals") return left === right;
  if (expression.operator === "contains") return typeof left === "string" && typeof right === "string" && left.includes(right);
  return typeof left === "string" && typeof right === "string" && new RegExp(right).test(left);
}

function compareUnicodeCodePoints(left: string, right: string) { const a = Array.from(left, (c) => c.codePointAt(0)!); const b = Array.from(right, (c) => c.codePointAt(0)!); for (let i = 0; i < Math.min(a.length, b.length); i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return a.length - b.length; }
export function canonicalizeJson(value: JsonValue): string { if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort(compareUnicodeCodePoints).map((key) => `${JSON.stringify(key)}:${canonicalizeJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }

export async function compileWorkflowDefinition(value: unknown, dependencies: CompilerDependencies = {}) {
  const root = exact(value, "", ["apiVersion", "kind", "metadata", "spec"], ["apiVersion", "kind", "metadata", "spec"]);
  if (root.apiVersion !== "workflow/v1alpha1") invalid("apiVersion"); if (root.kind !== "Workflow") invalid("kind");
  const metadata = exact(root.metadata, "metadata", ["name"], ["name"]); text(metadata.name, "metadata.name");
  const spec = exact(root.spec, "spec", ["nodes", "edges"], ["nodes", "edges"]);
  if (!Array.isArray(spec.nodes) || spec.nodes.length < 2) invalid("spec.nodes"); if (!Array.isArray(spec.edges)) invalid("spec.edges");
  const definition: WorkflowDefinition = { apiVersion: "workflow/v1alpha1", kind: "Workflow", metadata: { name: metadata.name as string }, spec: { nodes: spec.nodes.map((node, index) => validateNode(node, `spec.nodes[${index}]`)), edges: spec.edges.map((edge, index) => validateEdge(edge, `spec.edges[${index}]`)) } };
  validateGraph(definition);
  validateVariableReferences(definition);
  for (const [index, node] of definition.spec.nodes.entries()) if (node.type === "task.agent") {
    if (node.config.agentVersionRef !== null && dependencies.agentVersionExists && !await dependencies.agentVersionExists(node.config.agentVersionRef)) invalid(`spec.nodes[${index}].config.agentVersionRef`, node.id);
    if (dependencies.providerBindingExists && !await dependencies.providerBindingExists(node.config.providerBindingRef)) invalid(`spec.nodes[${index}].config.providerBindingRef`, node.id);
    if (dependencies.skillVersionExists) for (const [refIndex, ref] of node.config.skillVersionRefs.entries()) if (!await dependencies.skillVersionExists(ref)) invalid(`spec.nodes[${index}].config.skillVersionRefs[${refIndex}]`, node.id);
    if (dependencies.mcpServerVersionExists) for (const [refIndex, ref] of node.config.mcpServerVersionRefs.entries()) if (!await dependencies.mcpServerVersionExists(ref)) invalid(`spec.nodes[${index}].config.mcpServerVersionRefs[${refIndex}]`, node.id);
  }
  const canonicalJson = canonicalizeJson(definition as unknown as JsonValue);
  return { definition: JSON.parse(canonicalJson) as WorkflowDefinition, canonicalJson, hash: createHash("sha256").update(canonicalJson, "utf8").digest("hex") };
}
