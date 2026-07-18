"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { ApiError, ResourceList, WorkflowAuthoringDocument, WorkflowDefinitionDocument, WorkflowNodeDefinition } from "../client-types";
import type { ConditionExpression, JsonValue, WorkflowNode } from "../../lib/workflows/contracts";
import type { RuntimeOverlayNode } from "../../lib/workflows/visual-projection";

const FlowGramEditor = dynamic(() => import("./flowgram-editor").then((module) => module.FlowGramEditor), { ssr: false });

type BuilderProps = {
  definition: WorkflowDefinitionDocument;
  authoring: WorkflowAuthoringDocument;
  resources: { skills: ResourceList; mcps: ResourceList; agents: ResourceList };
  configuredModels: Record<string, string | null>;
  validationError: ApiError | null;
  onChange: (definition: WorkflowDefinitionDocument, authoring: WorkflowAuthoringDocument) => void;
  onTestRun: () => void;
  onAgentDirty: (nodeId: string) => void;
  runtimeNodes?: Record<string, RuntimeOverlayNode>;
};

const nodeChoices: Array<{ type: WorkflowNode["type"]; group: string; label: string }> = [
  { type: "input.prompt", group: "Input", label: "Prompt" },
  { type: "task.agent", group: "Task", label: "Agent" },
  { type: "logic.condition", group: "Logic", label: "Condition" },
  { type: "output.markdown", group: "Output", label: "Markdown" },
];

function createId(type: string) { return `${type.split(".")[1]}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)}`; }
function newNode(type: WorkflowNode["type"]): WorkflowNode {
  const id = createId(type);
  if (type === "task.agent") return { id, type, config: { systemPrompt: "You are a helpful workflow agent.", skillVersionRefs: [], mcpServerVersionRefs: [], providerBindingRef: "default", agentVersionRef: null } };
  if (type === "logic.condition") return { id, type, config: { branches: [{ id: "if", condition: clause() }, { id: "else" }] } };
  return { id, type, config: {} };
}
function clause(): ConditionExpression { return { type: "clause", left: { ref: "input.prompt" }, operator: "strict_equals", right: { literal: "" } }; }
function group(): ConditionExpression { return { type: "group", group: "and", children: [clause()] }; }
function updateAt<T>(items: T[], index: number, value: T) { return items.map((item, itemIndex) => itemIndex === index ? value : item); }
function nodeLabel(node: WorkflowNodeDefinition) { return node.type === "input.prompt" ? "Input" : node.type === "task.agent" ? "Agent" : node.type === "logic.condition" ? "Condition" : "Output"; }

export function WorkflowBoard({ definition, authoring, resources, configuredModels, validationError, onChange, onTestRun, onAgentDirty, runtimeNodes }: BuilderProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(definition.spec.nodes[0]?.id ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const selected = definition.spec.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const groupedChoices = useMemo(() => Object.groupBy(nodeChoices, (choice) => choice.group), []);
  function setNode(nextNode: WorkflowNode) { onChange({ ...definition, spec: { ...definition.spec, nodes: definition.spec.nodes.map((node) => node.id === nextNode.id ? nextNode : node) } }, authoring); }
  function addNode(type: WorkflowNode["type"]) {
    const node = newNode(type);
    onChange({ ...definition, spec: { ...definition.spec, nodes: [...definition.spec.nodes, node] } }, { ...authoring, nodes: { ...authoring.nodes, [node.id]: { position: { x: 220 + definition.spec.nodes.length * 40, y: 190 + definition.spec.nodes.length * 40 } } } });
    setSelectedNodeId(node.id); setAddOpen(false);
  }
  function deleteNode() {
    if (!selected) return;
    onChange({ ...definition, spec: { nodes: definition.spec.nodes.filter((node) => node.id !== selected.id), edges: definition.spec.edges.filter((edge) => edge.from !== selected.id && edge.to !== selected.id) } }, authoring);
    setSelectedNodeId(definition.spec.nodes.find((node) => node.id !== selected.id)?.id ?? null);
  }
  return <section className="builder-layout" aria-label="Workflow builder">
    <div className="builder-canvas-panel">
      <div className="builder-canvas" style={{ "--builder-zoom": `${zoom}%` } as React.CSSProperties}>
        <FlowGramEditor definition={definition} authoring={authoring} onNodeSelect={setSelectedNodeId} onGraphChange={onChange} runtimeNodes={runtimeNodes} readOnly={Boolean(runtimeNodes)} />
      </div>
      <div className="builder-bottom-bar" aria-label="Canvas controls">
        <label>Zoom <select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}><option value={75}>75%</option><option value={100}>100%</option><option value={125}>125%</option></select></label>
        {!runtimeNodes ? <div className="add-node-menu"><button className="button secondary" type="button" aria-expanded={addOpen} onClick={() => setAddOpen((open) => !open)}>+ Add node</button>{addOpen ? <div className="add-node-popover">{Object.entries(groupedChoices).map(([title, choices]) => <div key={title}><strong>{title}</strong>{choices?.map((choice) => <button key={choice.type} type="button" onClick={() => addNode(choice.type)}>{choice.label}</button>)}</div>)}</div> : null}</div> : null}
        <button className="button primary test-run" type="button" onClick={onTestRun}>▶ Test run</button>
      </div>
    </div>
    <aside className="builder-inspector" aria-label="Inspector">
      <div className="inspector-heading"><div><span>Inspector</span><h2>{selected ? nodeLabel(selected) : "Select a node"}</h2></div>{selected && !runtimeNodes ? <button className="icon-button" type="button" onClick={deleteNode} aria-label="Delete selected node">×</button> : null}</div>
      {validationError ? <div className="validation-error" role="alert"><strong>{validationError.message ?? "Definition is invalid"}</strong>{validationError.path ? <p>{validationError.path}</p> : null}</div> : null}
      {selected?.type === "input.prompt" ? <InputInspector /> : null}
      {selected?.type === "output.markdown" ? <OutputInspector /> : null}
      {selected?.type === "task.agent" ? <AgentInspector node={selected} resources={resources} configuredModels={configuredModels} authoring={authoring} onChange={setNode} onUpdate={(nextNode, nextAuthoring) => onChange({ ...definition, spec: { ...definition.spec, nodes: definition.spec.nodes.map((item) => item.id === nextNode.id ? nextNode : item) } }, nextAuthoring)} onDirty={() => onAgentDirty(selected.id)} /> : null}
      {selected?.type === "logic.condition" ? <ConditionInspector node={selected} onChange={setNode} /> : null}
    </aside>
  </section>;
}

function InputInspector() { return <div className="inspector-section"><p>The Test run dialog supplies this workflow&apos;s prompt.</p><label>Output reference<input value="input.prompt" readOnly /></label></div>; }
function OutputInspector() { return <div className="inspector-section"><p>Returns Markdown from the incoming output port.</p><label>Output format<input value="Markdown" readOnly /></label></div>; }

function AgentInspector({ node, resources, configuredModels, authoring, onChange, onUpdate, onDirty }: { node: Extract<WorkflowNode, { type: "task.agent" }>; resources: BuilderProps["resources"]; configuredModels: Record<string, string | null>; authoring: WorkflowAuthoringDocument; onChange: (node: WorkflowNode) => void; onUpdate: (node: WorkflowNode, authoring: WorkflowAuthoringDocument) => void; onDirty: () => void }) {
  const source = authoring.agentSources?.[node.id];
  const aliases = Object.keys(configuredModels).length ? Object.keys(configuredModels) : ["default"];
  function setConfig(change: Partial<typeof node.config>, marksSourceDirty = false) { onChange({ ...node, config: { ...node.config, ...change } }); if (marksSourceDirty) onDirty(); }
  function sourceChange(value: string) {
    if (value === "workflow") { onUpdate({ ...node, config: { ...node.config, agentVersionRef: null } }, { ...authoring, agentSources: { ...authoring.agentSources, [node.id]: { name: `${node.id} agent`, definition: { systemPrompt: node.config.systemPrompt }, agentVersionRef: null } } }); onDirty(); return; }
    const resource = resources.agents.resources.find((item) => item.id === value);
    if (!resource?.latestVersion) return;
    const definition = resource.latestVersion.definition;
    const nextConfig = {
      systemPrompt: typeof definition.systemPrompt === "string" ? definition.systemPrompt : node.config.systemPrompt,
      providerBindingRef: typeof definition.providerBindingRef === "string" ? definition.providerBindingRef : node.config.providerBindingRef,
      skillVersionRefs: Array.isArray(definition.skillVersionRefs) && definition.skillVersionRefs.every((ref) => typeof ref === "string") ? definition.skillVersionRefs : node.config.skillVersionRefs,
      mcpServerVersionRefs: Array.isArray(definition.mcpServerVersionRefs) && definition.mcpServerVersionRefs.every((ref) => typeof ref === "string") ? definition.mcpServerVersionRefs : node.config.mcpServerVersionRefs,
      agentVersionRef: resource.latestVersion.id,
    };
    onUpdate({ ...node, config: nextConfig }, { ...authoring, agentSources: { ...authoring.agentSources, [node.id]: { id: resource.id, name: resource.name, definition: definition as JsonValue, agentVersionRef: resource.latestVersion.id } } });
  }
  return <div className="inspector-section">
    <label>System prompt<textarea value={node.config.systemPrompt} onChange={(event) => setConfig({ systemPrompt: event.target.value }, Boolean(source))} rows={8} /></label>
    <label>Provider<select value={node.config.providerBindingRef} onChange={(event) => setConfig({ providerBindingRef: event.target.value })}>{aliases.map((alias) => <option key={alias} value={alias}>{alias}{configuredModels[alias] ? ` · ${configuredModels[alias]}` : ""}</option>)}</select></label>
    <ReferenceSelect label="Skills" values={node.config.skillVersionRefs} resources={resources.skills.resources} onChange={(skillVersionRefs) => setConfig({ skillVersionRefs })} />
    <ReferenceSelect label="MCP servers" values={node.config.mcpServerVersionRefs} resources={resources.mcps.resources} onChange={(mcpServerVersionRefs) => setConfig({ mcpServerVersionRefs })} />
    <label>Agent source<select value={source?.id ?? (source ? "workflow" : "")} onChange={(event) => sourceChange(event.target.value)}><option value="">No source selected</option><option value="workflow">Workflow agent — create/update on Save</option>{resources.agents.resources.filter((item) => item.latestVersion && !item.archivedAt).map((item) => <option key={item.id} value={item.id}>{item.name} v{item.latestVersion?.version}</option>)}</select></label>
    {source ? <p className="inspector-note">Saving this dirty source creates its next agent version; Skills and MCP definitions remain reference-only.</p> : null}
  </div>;
}

function ReferenceSelect({ label, values, resources, onChange }: { label: string; values: string[]; resources: ResourceList["resources"]; onChange: (values: string[]) => void }) {
  const available = resources.filter((resource) => resource.latestVersion && !resource.archivedAt);
  return <fieldset><legend>{label}</legend>{available.length === 0 ? <p className="inspector-note">No existing {label.toLowerCase()}.</p> : available.map((resource) => { const ref = resource.latestVersion!.id; return <label className="check-label" key={resource.id}><input type="checkbox" checked={values.includes(ref)} onChange={(event) => onChange(event.target.checked ? [...values, ref] : values.filter((value) => value !== ref))} />{resource.name} <span>v{resource.latestVersion?.version}</span></label>; })}</fieldset>;
}

function ConditionInspector({ node, onChange }: { node: Extract<WorkflowNode, { type: "logic.condition" }>; onChange: (node: WorkflowNode) => void }) {
  const branches = node.config.branches;
  function setBranches(next: typeof branches) { onChange({ ...node, config: { branches: next } }); }
  function move(index: number, direction: number) { const to = index + direction; if (to < 0 || to >= branches.length - 1) return; const next = [...branches]; [next[index], next[to]] = [next[to], next[index]]; setBranches(next); }
  return <div className="inspector-section condition-inspector"><p>Ordered branches expose matching source ports on the canvas.</p>{branches.map((branch, index) => branch.condition ? <section className="condition-branch" key={branch.id}><header><strong>{index === 0 ? "If" : "Else if"}</strong><span>Priority {index + 1}</span><button type="button" onClick={() => move(index, -1)} aria-label="Move branch up">↑</button><button type="button" onClick={() => move(index, 1)} aria-label="Move branch down">↓</button><button type="button" onClick={() => setBranches(branches.filter((_, current) => current !== index))} disabled={branches.length <= 2} aria-label="Remove branch">−</button></header><ExpressionEditor value={branch.condition} onChange={(condition) => setBranches(updateAt(branches, index, { ...branch, condition }))} /></section> : <section className="condition-branch condition-else" key={branch.id}><strong>Else</strong><span>Fallback branch</span></section>)}<button className="button secondary" type="button" onClick={() => setBranches([...branches.slice(0, -1), { id: createId("branch"), condition: clause() }, branches[branches.length - 1]])}>+ Add else if</button></div>;
}

function ExpressionEditor({ value, onChange }: { value: ConditionExpression; onChange: (expression: ConditionExpression) => void }) {
  if ("group" in value) return <div className="expression-group"><label>Group<select value={value.group} onChange={(event) => onChange({ ...value, group: event.target.value as "and" | "or" })}><option value="and">and</option><option value="or">or</option></select></label>{value.children.map((child, index) => <div key={index} className="expression-child"><ExpressionEditor value={child} onChange={(next) => onChange({ ...value, children: updateAt(value.children, index, next) })} /><button type="button" onClick={() => onChange({ ...value, children: value.children.filter((_, item) => item !== index) })} disabled={value.children.length === 1} aria-label="Remove condition">−</button></div>)}<button type="button" onClick={() => onChange({ ...value, children: [...value.children, clause()] })}>+ Clause</button><button type="button" onClick={() => onChange({ ...value, children: [...value.children, group()] })}>+ Group</button></div>;
  const right = value.right;
  const rightRef = "ref" in right;
  const rightValue = rightRef ? right.ref : typeof right.literal === "string" ? right.literal : JSON.stringify(right.literal);
  return <div className="expression-clause"><label>Left ref<input value={value.left.ref} onChange={(event) => onChange({ ...value, left: { ref: event.target.value } })} /></label><label>Operator<select value={value.operator} onChange={(event) => onChange({ ...value, operator: event.target.value as typeof value.operator })}><option value="strict_equals">equals</option><option value="contains">contains</option><option value="regex">regex</option></select></label><label>Right<select value={rightRef ? "ref" : "literal"} onChange={(event) => onChange({ ...value, right: event.target.value === "ref" ? { ref: "" } : { literal: "" } })}><option value="literal">Literal</option><option value="ref">Reference</option></select><input value={rightValue} onChange={(event) => onChange({ ...value, right: rightRef ? { ref: event.target.value } : { literal: event.target.value } })} /></label></div>;
}
