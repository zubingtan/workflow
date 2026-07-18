import { evaluateCondition } from "../workflows/compiler";
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "../workflows/contracts";

export function topologicalNodes(definition: WorkflowDefinition): WorkflowNode[] {
  const byId = new Map(definition.spec.nodes.map((node) => [node.id, node]));
  const pending = new Map(definition.spec.nodes.map((node) => [node.id, 0]));
  const next = new Map(definition.spec.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of definition.spec.edges) { pending.set(edge.to, pending.get(edge.to)! + 1); next.get(edge.from)!.push(edge.to); }
  const ready = definition.spec.nodes.filter((node) => pending.get(node.id) === 0).map((node) => node.id);
  const ordered: WorkflowNode[] = [];
  while (ready.length) { const id = ready.shift()!; ordered.push(byId.get(id)!); for (const target of next.get(id)!) { pending.set(target, pending.get(target)! - 1); if (pending.get(target) === 0) ready.push(target); } }
  return ordered;
}

export function selectedBranch(node: Extract<WorkflowNode, { type: "logic.condition" }>, values: Record<string, unknown>) {
  return node.config.branches.find((branch) => branch.condition === undefined || evaluateCondition(branch.condition, values))!.id;
}

export function edgeIsSelected(edge: WorkflowEdge, source: WorkflowNode, branch: string | undefined) {
  return source.type !== "logic.condition" || edge.sourcePort === branch;
}

export function readValue(source: string, values: Record<string, unknown>) {
  if (source in values) return values[source];
  return source.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, values);
}
