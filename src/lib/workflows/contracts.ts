export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ValueOperand = { literal: JsonValue } | { ref: string };

export type ConditionClause = {
  type?: "clause";
  left: { ref: string };
  operator: "strict_equals" | "contains" | "regex";
  right: ValueOperand;
};

export type ConditionGroup = {
  type?: "group";
  group: "and" | "or";
  children: ConditionExpression[];
};

export type ConditionExpression = ConditionClause | ConditionGroup;

export type WorkflowNode =
  | { id: string; type: "input.prompt"; config: Record<string, never> }
  | { id: string; type: "task.agent"; config: { systemPrompt: string; skillVersionRefs: string[]; mcpServerVersionRefs: string[]; providerBindingRef: string; agentVersionRef: string | null } }
  | { id: string; type: "logic.condition"; config: { branches: Array<{ id: string; condition?: ConditionExpression }> } }
  | { id: string; type: "output.markdown"; config: Record<string, never> };

export type WorkflowEdge = {
  from: string;
  to: string;
  sourcePort?: string;
  targetPort?: string;
  mapping: Array<{ source: string; target: string }>;
};

export type WorkflowDefinition = {
  apiVersion: "workflow/v1alpha1";
  kind: "Workflow";
  metadata: { name: string };
  spec: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
};

export type WorkflowAuthoring = {
  nodes?: Record<string, { position?: { x: number; y: number } }>;
  agentSources?: Record<string, { id?: string; name: string; definition: JsonValue; agentVersionRef?: string | null }>;
  [key: string]: JsonValue | undefined;
};

export type ResourceKind = "agents" | "skills" | "mcps";
