import { randomUUID } from "node:crypto";
import { getDatabase } from "../database";
import { compileWorkflowDefinition } from "./compiler";
import { providerBindingExists } from "./provider-bindings";

export async function importWorkflowDefinition(value: unknown) {
  const compiled = await compileWorkflowDefinition(value, {
    agentVersionExists: async (reference) => {
      const rows = await getDatabase()`
        SELECT 1 FROM agent_definition_versions WHERE id = ${reference} LIMIT 1
      `;
      return rows.length === 1;
    },
    providerBindingExists,
  });
  const sql = getDatabase();
  const name = compiled.definition.metadata.name;

  return sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${name}, 0))`;
    let [workflow] = await transaction`
      SELECT id, name FROM workflows WHERE name = ${name}
    `;
    if (!workflow) {
      [workflow] = await transaction`
        INSERT INTO workflows (id, name)
        VALUES (${`workflow-${randomUUID()}`}, ${name})
        RETURNING id, name
      `;
    }

    const [latest] = await transaction`
      SELECT COALESCE(MAX(version), 0)::int AS version
      FROM workflow_definition_versions
      WHERE workflow_id = ${workflow.id}
    `;
    const [version] = await transaction`
      INSERT INTO workflow_definition_versions (
        id, workflow_id, version, definition, canonical_json, hash
      ) VALUES (
        ${`workflow-definition-${randomUUID()}`},
        ${workflow.id},
        ${latest.version + 1},
        ${transaction.json(compiled.definition)},
        ${compiled.canonicalJson},
        ${compiled.hash}
      )
      RETURNING id, version, hash
    `;

    return {
      workflow: { id: workflow.id, name: workflow.name },
      workflowDefinitionVersion: {
        id: version.id,
        version: version.version,
        hash: version.hash,
        definition: compiled.definition,
      },
    };
  });
}

export async function listWorkflowDefinitions() {
  const rows = await getDatabase()`
    SELECT
      workflow.id,
      workflow.name,
      version.id AS definition_version_id,
      version.version,
      version.hash
    FROM workflows AS workflow
    JOIN LATERAL (
      SELECT id, version, hash
      FROM workflow_definition_versions
      WHERE workflow_id = workflow.id
      ORDER BY version DESC
      LIMIT 1
    ) AS version ON true
    ORDER BY workflow.name, workflow.id
  `;

  return {
    workflows: rows.map((row) => ({
      id: row.id,
      name: row.name,
      latestDefinitionVersion: {
        id: row.definition_version_id,
        version: row.version,
        hash: row.hash,
      },
    })),
  };
}

export async function getWorkflowDefinition(id: string) {
  const [row] = await getDatabase()`
    SELECT
      workflow.id,
      workflow.name,
      version.id AS definition_version_id,
      version.version,
      version.hash,
      version.definition
    FROM workflows AS workflow
    JOIN LATERAL (
      SELECT id, version, hash, definition
      FROM workflow_definition_versions
      WHERE workflow_id = workflow.id
      ORDER BY version DESC
      LIMIT 1
    ) AS version ON true
    WHERE workflow.id = ${id}
  `;
  if (!row) return null;

  return {
    workflow: { id: row.id, name: row.name },
    workflowDefinitionVersion: {
      id: row.definition_version_id,
      version: row.version,
      hash: row.hash,
      definition: row.definition,
    },
  };
}
