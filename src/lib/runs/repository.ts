import { randomUUID } from "node:crypto";
import { getDatabase } from "../database";
import { topologicalNodes } from "./scheduler";
import type { WorkflowDefinition } from "../workflows/contracts";

export class RunValidationError extends Error {
  readonly code = "validation_error";
  constructor(readonly path: string) { super(`Invalid Run request at ${path || "document"}`); }
}
function request(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RunValidationError("");
  const body = value as Record<string, unknown>;
  if (typeof body.workflowDefinitionVersionId !== "string" || !body.workflowDefinitionVersionId) throw new RunValidationError("workflowDefinitionVersionId");
  if (!body.input || typeof body.input !== "object" || Array.isArray(body.input) || typeof (body.input as Record<string, unknown>).prompt !== "string" || !(body.input as Record<string, unknown>).prompt) throw new RunValidationError("input.prompt");
  return { versionId: body.workflowDefinitionVersionId, prompt: (body.input as Record<string, string>).prompt };
}
export async function createWorkflowRun(value: unknown) {
  const input = request(value); const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [version] = await transaction`SELECT definition FROM workflow_definition_versions WHERE id = ${input.versionId}`;
    if (!version) return null;
    const definition = version.definition as WorkflowDefinition; const runId = `run-${randomUUID()}`;
    await transaction`INSERT INTO workflow_runs (id, workflow_definition_version_id, status, input) VALUES (${runId}, ${input.versionId}, 'queued', ${transaction.json({ prompt: input.prompt })})`;
    for (const [index, node] of topologicalNodes(definition).entries()) {
      await transaction`INSERT INTO node_runs (id, workflow_run_id, node_id, node_type, execution_order, status, agent_definition_version_id, provider_binding_ref) VALUES (${`node-run-${randomUUID()}`}, ${runId}, ${node.id}, ${node.type}, ${index + 1}, ${node.type === "input.prompt" ? "queued" : "pending"}, ${node.type === "task.agent" ? node.config.agentVersionRef : null}, ${node.type === "task.agent" ? node.config.providerBindingRef : null})`;
    }
    await transaction`INSERT INTO execution_events (id, workflow_run_id, sequence, type) VALUES (${`event-${randomUUID()}`}, ${runId}, 1, 'workflow.run.queued')`;
    await transaction`INSERT INTO queue_jobs (id, workflow_run_id, status) VALUES (${`queue-job-${randomUUID()}`}, ${runId}, 'available')`;
    return { runId, status: "queued" as const };
  });
}
const iso = (value: Date | string | null) => value === null ? null : new Date(value).toISOString();
export async function getWorkflowRun(id: string) {
  const sql = getDatabase(); const [run] = await sql`SELECT run.*, workflow.id AS workflow_id, workflow.name AS workflow_name, version.id AS version_id, version.version, version.hash, version.definition FROM workflow_runs run JOIN workflow_definition_versions version ON version.id=run.workflow_definition_version_id JOIN workflows workflow ON workflow.id=version.workflow_id WHERE run.id=${id}`;
  if (!run) return null;
  const nodes = await sql`SELECT node.*, agent.id AS agent_version_id, agent.version AS agent_version, agent.hash AS agent_hash FROM node_runs node LEFT JOIN agent_definition_versions agent ON agent.id=node.agent_definition_version_id WHERE node.workflow_run_id=${id} ORDER BY node.execution_order`;
  const events = await sql`SELECT event.sequence,event.type,event.occurred_at,node.node_id,event.payload FROM execution_events event LEFT JOIN node_runs node ON node.id=event.node_run_id WHERE event.workflow_run_id=${id} ORDER BY event.sequence`;
  return { run: { id: run.id, status: run.status, error: run.error_code ? { code: run.error_code, message: run.error_message, nodeId: "" } : null, createdAt: iso(run.created_at), startedAt: iso(run.started_at), completedAt: iso(run.completed_at), workflow: { id: run.workflow_id, name: run.workflow_name }, workflowDefinitionVersion: { id: run.version_id, version: run.version, hash: run.hash, definition: run.definition }, input: run.input, output: run.output, nodes: nodes.map((node) => ({ id: node.id, nodeId: node.node_id, type: node.node_type, status: node.status, input: node.input, output: node.output, skipReason: node.skip_reason, error: node.error_code ? { code: node.error_code, message: node.error_message } : null, agentDefinitionVersion: node.agent_version_id ? { id: node.agent_version_id, version: node.agent_version, hash: node.agent_hash } : null, providerBindingRef: node.provider_binding_ref })), timeline: events.map((event) => ({ sequence: event.sequence, type: event.type, occurredAt: iso(event.occurred_at), ...(event.node_id ? { nodeId: event.node_id } : {}), ...(event.payload ?? {}) })) } };
}
export async function listWorkflowRuns(workflowId: string) {
  const [workflow] = await getDatabase()`SELECT id,name FROM workflows WHERE id=${workflowId}`; if (!workflow) return null;
  const runs = await getDatabase()`SELECT run.id,run.status,run.input,run.output,run.created_at,run.started_at,run.completed_at,version.id AS version_id,version.version,version.hash FROM workflow_runs run JOIN workflow_definition_versions version ON version.id=run.workflow_definition_version_id WHERE version.workflow_id=${workflowId} ORDER BY run.created_at DESC`;
  return { workflow: { id: workflow.id, name: workflow.name }, runs: runs.map((run) => ({ id: run.id, status: run.status, input: run.input, output: run.output, createdAt: iso(run.created_at), startedAt: iso(run.started_at), completedAt: iso(run.completed_at), workflowDefinitionVersion: { id: run.version_id, version: run.version, hash: run.hash } })) };
}
