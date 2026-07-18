import { randomUUID } from "node:crypto";
import { getDatabase } from "../database";
import { canonicalizeJson, compileWorkflowDefinition, WorkflowValidationError } from "./compiler";
import { providerBindingExists } from "./provider-bindings";
import type { JsonValue, WorkflowAuthoring, WorkflowDefinition } from "./contracts";

export function defaultWorkflow(name = "Untitled workflow"): WorkflowDefinition {
  return {
    apiVersion: "workflow/v1alpha1", kind: "Workflow", metadata: { name },
    spec: {
      nodes: [
        { id: "prompt", type: "input.prompt", config: {} },
        { id: "result", type: "output.markdown", config: {} },
      ],
      edges: [{ from: "prompt", to: "result", mapping: [{ source: "prompt", target: "output" }] }],
    },
  };
}

function authoring(value: unknown): WorkflowAuthoring {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new WorkflowValidationError("authoring");
  return value as WorkflowAuthoring;
}

const compilerDependencies = {
  providerBindingExists,
  agentVersionExists: async (reference: string) => (await getDatabase()`SELECT 1 FROM agent_definition_versions WHERE id = ${reference} LIMIT 1`).length === 1,
  skillVersionExists: async (reference: string) => (await getDatabase()`SELECT 1 FROM skill_definition_versions WHERE id = ${reference} LIMIT 1`).length === 1,
  mcpServerVersionExists: async (reference: string) => (await getDatabase()`SELECT 1 FROM mcp_definition_versions WHERE id = ${reference} LIMIT 1`).length === 1,
};

async function persistDefinition(
  transaction: any,
  workflowId: string,
  definition: WorkflowDefinition,
  workflowAuthoring: WorkflowAuthoring,
) {
  const compiled = await compileWorkflowDefinition(definition, compilerDependencies);
  const [latest] = await transaction`SELECT COALESCE(MAX(version), 0)::int AS version FROM workflow_definition_versions WHERE workflow_id = ${workflowId}`;
  const [version] = await transaction`
    INSERT INTO workflow_definition_versions (id, workflow_id, version, definition, authoring, canonical_json, hash)
    VALUES (${`workflow-definition-${randomUUID()}`}, ${workflowId}, ${latest.version + 1}, ${transaction.json(compiled.definition)}, ${transaction.json(workflowAuthoring)}, ${compiled.canonicalJson}, ${compiled.hash})
    RETURNING id, version, hash, definition, authoring
  `;
  return version;
}

export async function importWorkflowDefinition(value: unknown) {
  const compiled = await compileWorkflowDefinition(value, compilerDependencies);
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const name = compiled.definition.metadata.name;
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
    let [workflow] = await transaction`SELECT id, name FROM workflows WHERE name = ${name} AND archived_at IS NULL`;
    if (!workflow) [workflow] = await transaction`INSERT INTO workflows (id, name) VALUES (${`workflow-${randomUUID()}`}, ${name}) RETURNING id, name`;
    const version = await persistDefinition(transaction, workflow.id, compiled.definition, {});
    return { workflow: { id: workflow.id, name: workflow.name }, workflowDefinitionVersion: { id: version.id, version: version.version, hash: version.hash, definition: version.definition, authoring: version.authoring } };
  });
}

export async function createWorkflow(value: unknown) {
  const body = value === undefined ? {} : (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null);
  if (!body) throw new WorkflowValidationError("");
  if (Object.keys(body).some((key) => !["name"].includes(key))) throw new WorkflowValidationError(Object.keys(body).find((key) => key !== "name")!);
  const name = body.name === undefined ? "Untitled workflow" : typeof body.name === "string" && body.name ? body.name : (() => { throw new WorkflowValidationError("name"); })();
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [workflow] = await transaction`INSERT INTO workflows (id, name) VALUES (${`workflow-${randomUUID()}`}, ${name}) RETURNING id, name`;
    const version = await persistDefinition(transaction, workflow.id, defaultWorkflow(name), {});
    return { workflow: { id: workflow.id, name: workflow.name }, workflowDefinitionVersion: { id: version.id, version: version.version, hash: version.hash, definition: version.definition, authoring: version.authoring } };
  });
}

export async function listWorkflowDefinitions() {
  const rows = await getDatabase()`
    SELECT workflow.id, workflow.name, version.id AS definition_version_id, version.version, version.hash
    FROM workflows workflow JOIN LATERAL (
      SELECT id, version, hash FROM workflow_definition_versions WHERE workflow_id = workflow.id ORDER BY version DESC LIMIT 1
    ) version ON true WHERE workflow.archived_at IS NULL ORDER BY workflow.name, workflow.id
  `;
  return { workflows: rows.map((row) => ({ id: row.id, name: row.name, latestDefinitionVersion: { id: row.definition_version_id, version: row.version, hash: row.hash } })) };
}

export async function getWorkflowDefinition(id: string) {
  const [row] = await getDatabase()`
    SELECT workflow.id, workflow.name, version.id AS definition_version_id, version.version, version.hash, version.definition, version.authoring
    FROM workflows workflow JOIN LATERAL (
      SELECT id, version, hash, definition, authoring FROM workflow_definition_versions WHERE workflow_id = workflow.id ORDER BY version DESC LIMIT 1
    ) version ON true WHERE workflow.id = ${id} AND workflow.archived_at IS NULL
  `;
  if (!row) return null;
  return { workflow: { id: row.id, name: row.name }, workflowDefinitionVersion: { id: row.definition_version_id, version: row.version, hash: row.hash, definition: row.definition, authoring: row.authoring } };
}

export async function updateWorkflow(id: string, value: unknown) {
  const body = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!body) throw new WorkflowValidationError("");
  if (Object.keys(body).some((key) => !["definition", "authoring", "agents"].includes(key))) throw new WorkflowValidationError(Object.keys(body).find((key) => !["definition", "authoring", "agents"].includes(key))!);
  if (!("definition" in body)) throw new WorkflowValidationError("definition");
  const workflowAuthoring = structuredClone(authoring(body.authoring));
  const definition = structuredClone(body.definition) as WorkflowDefinition;
  const sql = getDatabase();
  return sql.begin(async (transaction) => {
    const [workflow] = await transaction`SELECT id, name FROM workflows WHERE id = ${id} AND archived_at IS NULL FOR UPDATE`;
    if (!workflow) return null;
    if (body.agents !== undefined) {
      if (!Array.isArray(body.agents)) throw new WorkflowValidationError("agents");
      for (const [index, raw] of body.agents.entries()) {
        const agent = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
        if (!agent || typeof agent.nodeId !== "string" || !agent.nodeId || typeof agent.name !== "string" || !agent.name || !agent.definition || typeof agent.definition !== "object") throw new WorkflowValidationError(`agents[${index}]`);
        const node = definition.spec?.nodes?.find((item) => item.id === agent.nodeId);
        if (!node || node.type !== "task.agent") throw new WorkflowValidationError(`agents[${index}].nodeId`);
        const agentId = typeof agent.id === "string" && agent.id ? agent.id : `agent-${randomUUID()}`;
        const [existing] = await transaction`SELECT id FROM agent_definitions WHERE id = ${agentId} FOR UPDATE`;
        if (!existing) await transaction`INSERT INTO agent_definitions (id, name) VALUES (${agentId}, ${agent.name})`;
        else await transaction`UPDATE agent_definitions SET name = ${agent.name}, archived_at = NULL WHERE id = ${agentId}`;
        const [latest] = await transaction`SELECT COALESCE(MAX(version), 0)::int AS version FROM agent_definition_versions WHERE agent_definition_id = ${agentId}`;
        const canonical = canonicalizeJson(agent.definition as JsonValue);
        const [version] = await transaction`INSERT INTO agent_definition_versions (id, agent_definition_id, version, definition, canonical_json, hash) VALUES (${`agent-version-${randomUUID()}`}, ${agentId}, ${latest.version + 1}, ${transaction.json(agent.definition as any)}, ${canonical}, ${await import("node:crypto").then(({ createHash }) => createHash("sha256").update(canonical).digest("hex"))}) RETURNING id`;
        node.config.agentVersionRef = version.id;
        const source = workflowAuthoring.agentSources?.[agent.nodeId];
        if (source) workflowAuthoring.agentSources = { ...workflowAuthoring.agentSources, [agent.nodeId]: { ...source, id: agentId, name: agent.name, definition: agent.definition as JsonValue, agentVersionRef: version.id } };
      }
    }
    const compiled = await compileWorkflowDefinition(definition, compilerDependencies);
    if (compiled.definition.metadata.name !== workflow.name) await transaction`UPDATE workflows SET name = ${compiled.definition.metadata.name} WHERE id = ${id}`;
    const version = await persistDefinition(transaction, id, compiled.definition, workflowAuthoring);
    return { workflow: { id, name: compiled.definition.metadata.name }, workflowDefinitionVersion: { id: version.id, version: version.version, hash: version.hash, definition: version.definition, authoring: version.authoring } };
  });
}

export async function deleteWorkflow(id: string) {
  const rows = await getDatabase()`DELETE FROM workflows WHERE id = ${id} RETURNING id`;
  return rows.length === 1;
}
