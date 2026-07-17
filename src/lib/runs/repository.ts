import { randomUUID } from "node:crypto";
import { getDatabase } from "../database";

type JsonObject = Record<string, unknown>;

export class RunValidationError extends Error {
  readonly code = "validation_error";

  constructor(readonly path: string) {
    super(`Invalid Run request at ${path || "document"}`);
    this.name = "RunValidationError";
  }
}

function object(value: unknown, path: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RunValidationError(path);
  }
  return value as JsonObject;
}

function string(value: unknown, path: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new RunValidationError(path);
  }
  return value;
}

function validateRunRequest(value: unknown) {
  const request = object(value, "");
  const workflowDefinitionVersionId = string(
    request.workflowDefinitionVersionId,
    "workflowDefinitionVersionId",
  );
  const input = object(request.input, "input");
  const prompt = string(input.prompt, "input.prompt");

  for (const key of Object.keys(request)) {
    if (!["workflowDefinitionVersionId", "input"].includes(key)) {
      throw new RunValidationError(key);
    }
  }
  for (const key of Object.keys(input)) {
    if (key !== "prompt") throw new RunValidationError(`input.${key}`);
  }

  return { workflowDefinitionVersionId, prompt };
}

export async function createWorkflowRun(value: unknown) {
  const request = validateRunRequest(value);
  const sql = getDatabase();

  return sql.begin(async (transaction) => {
    const [version] = await transaction`
      SELECT definition
      FROM workflow_definition_versions
      WHERE id = ${request.workflowDefinitionVersionId}
    `;
    if (!version) return null;

    const definition = version.definition as {
      spec: {
        nodes: Array<{
          id: string;
          type: "input.prompt" | "process.agent" | "output.markdown";
          config: { agentVersionRef?: string; providerBindingRef?: string };
        }>;
      };
    };
    const runId = `run-${randomUUID()}`;
    await transaction`
      INSERT INTO workflow_runs (
        id, workflow_definition_version_id, status, input
      ) VALUES (
        ${runId}, ${request.workflowDefinitionVersionId}, 'queued',
        ${transaction.json({ prompt: request.prompt })}
      )
    `;

    const nodes = ["input.prompt", "process.agent", "output.markdown"].map(
      (type) => definition.spec.nodes.find((node) => node.type === type)!,
    );
    for (const [index, node] of nodes.entries()) {
      await transaction`
        INSERT INTO node_runs (
          id,
          workflow_run_id,
          node_id,
          node_type,
          execution_order,
          status,
          agent_definition_version_id,
          provider_binding_ref
        ) VALUES (
          ${`node-run-${randomUUID()}`},
          ${runId},
          ${node.id},
          ${node.type},
          ${index + 1},
          ${index === 0 ? "queued" : "pending"},
          ${node.config.agentVersionRef ?? null},
          ${node.config.providerBindingRef ?? null}
        )
      `;
    }

    await transaction`
      INSERT INTO execution_events (
        id, workflow_run_id, sequence, type
      ) VALUES (
        ${`event-${randomUUID()}`}, ${runId}, 1, 'workflow.run.queued'
      )
    `;
    await transaction`
      INSERT INTO queue_jobs (id, workflow_run_id, status)
      VALUES (${`queue-job-${randomUUID()}`}, ${runId}, 'available')
    `;

    return { runId, status: "queued" as const };
  });
}

function date(value: Date | string | null) {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function providerSnapshot(value: JsonObject | null) {
  if (value === null) return null;
  return {
    bindingAlias: value.bindingAlias,
    effectiveProvider: value.effectiveProvider,
    effectiveModel: value.effectiveModel,
    parameters: value.parameters,
  };
}

function runtimeError(code: string | null, message: string | null, nodeId: string) {
  if (code === null || message === null) return null;
  return { code, message, nodeId };
}

const timelineTypes = new Set([
  "workflow.run.queued",
  "workflow.run.started",
  "node.attempt.started",
  "node.attempt.succeeded",
  "node.attempt.failed",
  "node.run.skipped",
  "agent.execution.started",
  "agent.execution.succeeded",
  "agent.execution.failed",
  "artifact.created",
  "workflow.run.succeeded",
  "workflow.run.failed",
]);

const failureTimelineTypes = new Set([
  "agent.execution.failed",
  "node.attempt.failed",
  "workflow.run.failed",
]);

const timelineErrorCodes = new Set([
  "provider_auth_failed",
  "provider_timeout",
  "provider_empty_output",
  "worker_lost",
  "outcome_unknown",
]);

function timelineArtifact(value: unknown, nodeId: string | null) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as JsonObject;
  const source = payload.source;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
  const sourceValue = source as JsonObject;
  const sourceNodeId = sourceValue.nodeId;
  const sha256 = payload.sha256;
  const sizeBytes = payload.sizeBytes;
  if (
    sourceValue.kind !== "node.output"
    || typeof sourceNodeId !== "string"
    || sourceNodeId !== nodeId
    || typeof sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(sha256)
    || payload.mediaType !== "text/markdown"
    || typeof sizeBytes !== "number"
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || payload.sensitivity !== "internal"
    || payload.retentionPolicy !== "run-history"
  ) return null;
  return {
    source: { kind: "node.output" as const, nodeId: sourceNodeId },
    sha256,
    mediaType: "text/markdown" as const,
    sizeBytes,
    sensitivity: "internal" as const,
    retentionPolicy: "run-history" as const,
  };
}

export async function getWorkflowRun(id: string) {
  const sql = getDatabase();
  return sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (transaction) => {
    const [run] = await transaction`
      SELECT
        run.id,
        run.status,
        run.input,
        run.created_at,
        run.started_at,
        run.completed_at,
        run.error_code,
        run.error_message,
        workflow.id AS workflow_id,
        workflow.name AS workflow_name,
        version.id AS version_id,
        version.version,
        version.hash,
        version.definition
      FROM workflow_runs AS run
      JOIN workflow_definition_versions AS version
        ON version.id = run.workflow_definition_version_id
      JOIN workflows AS workflow ON workflow.id = version.workflow_id
      WHERE run.id = ${id}
    `;
    if (!run) return null;

    const nodes = await transaction`
      SELECT
        node.id,
        node.node_id,
        node.node_type,
        node.status,
        node.provider_binding_ref,
        node.output,
        node.error_code AS node_error_code,
        node.error_message AS node_error_message,
        node.skip_reason,
        agent_version.id AS agent_version_id,
        agent_version.version AS agent_version_number,
        agent_version.hash AS agent_version_hash,
        attempt.id AS attempt_id,
        attempt.number AS attempt_number,
        attempt.status AS attempt_status,
        attempt.started_at AS attempt_started_at,
        attempt.completed_at AS attempt_completed_at,
        attempt.provider_snapshot AS attempt_provider_snapshot,
        attempt.error_code AS attempt_error_code,
        attempt.error_message AS attempt_error_message,
        execution.id AS execution_id,
        execution.status AS execution_status,
        execution.started_at AS execution_started_at,
        execution.completed_at AS execution_completed_at,
        execution.provider_snapshot AS execution_provider_snapshot,
        execution.error_code AS execution_error_code,
        execution.error_message AS execution_error_message,
        execution_agent.id AS execution_agent_id,
        execution_agent.version AS execution_agent_version,
        execution_agent.hash AS execution_agent_hash
      FROM node_runs AS node
      LEFT JOIN agent_definition_versions AS agent_version
        ON agent_version.id = node.agent_definition_version_id
      LEFT JOIN node_run_attempts AS attempt ON attempt.node_run_id = node.id
      LEFT JOIN agent_executions AS execution
        ON execution.node_run_attempt_id = attempt.id
      LEFT JOIN agent_definition_versions AS execution_agent
        ON execution_agent.id = execution.agent_definition_version_id
      WHERE node.workflow_run_id = ${id}
      ORDER BY node.execution_order
    `;

    const events = await transaction`
      SELECT
        event.sequence,
        event.type,
        event.occurred_at,
        event.error_code,
        event.skip_reason,
        event.payload,
        node.node_id
      FROM execution_events AS event
      LEFT JOIN node_runs AS node ON node.id = event.node_run_id
      WHERE event.workflow_run_id = ${id}
      ORDER BY event.sequence ASC
    `;

    const projectedNodes = nodes.map((node) => ({
      id: node.id,
      nodeId: node.node_id,
      type: node.node_type,
      status: node.status,
      error: runtimeError(node.node_error_code, node.node_error_message, node.node_id),
      skipReason: node.skip_reason,
      agentDefinitionVersion: node.agent_version_id === null ? null : {
        id: node.agent_version_id,
        version: node.agent_version_number,
        hash: node.agent_version_hash,
      },
      providerBindingRef: node.provider_binding_ref,
      output: node.output,
      attempt: node.attempt_id === null ? null : {
        id: node.attempt_id,
        number: node.attempt_number,
        status: node.attempt_status,
        error: runtimeError(node.attempt_error_code, node.attempt_error_message, node.node_id),
        startedAt: date(node.attempt_started_at),
        completedAt: date(node.attempt_completed_at),
        providerSnapshot: providerSnapshot(node.attempt_provider_snapshot),
        agentExecution: node.execution_id === null ? null : {
          id: node.execution_id,
          status: node.execution_status,
          error: runtimeError(
            node.execution_error_code,
            node.execution_error_message,
            node.node_id,
          ),
          startedAt: date(node.execution_started_at),
          completedAt: date(node.execution_completed_at),
          agentDefinitionVersion: {
            id: node.execution_agent_id,
            version: node.execution_agent_version,
            hash: node.execution_agent_hash,
          },
          providerSnapshot: providerSnapshot(node.execution_provider_snapshot),
        },
      },
    }));
    const processNode = nodes.find((node) => node.node_type === "process.agent");
    const timeline = events.flatMap((event) => {
      if (!timelineTypes.has(event.type)) return [];
      const occurredAt = date(event.occurred_at);
      if (occurredAt === null) return [];
      const projected: Record<string, unknown> = {
        sequence: event.sequence,
        type: event.type,
        occurredAt,
      };
      if (typeof event.node_id === "string") projected.nodeId = event.node_id;
      if (failureTimelineTypes.has(event.type) && timelineErrorCodes.has(event.error_code)) {
        projected.code = event.error_code;
      }
      if (event.type === "node.run.skipped" && event.skip_reason === "upstream_failed") {
        projected.reason = event.skip_reason;
      }
      if (event.type === "artifact.created") {
        const artifact = timelineArtifact(event.payload, event.node_id);
        if (artifact !== null) projected.artifact = artifact;
      }
      return [projected];
    });

    return {
      run: {
        id: run.id,
        status: run.status,
        error: runtimeError(run.error_code, run.error_message, processNode?.node_id ?? "analyze"),
        createdAt: date(run.created_at),
        startedAt: date(run.started_at),
        completedAt: date(run.completed_at),
        workflow: { id: run.workflow_id, name: run.workflow_name },
        workflowDefinitionVersion: {
          id: run.version_id,
          version: run.version,
          hash: run.hash,
          definition: run.definition,
        },
        input: run.input,
        nodes: projectedNodes,
        timeline,
      },
    };
  });
}

export async function listWorkflowRuns(workflowId: string) {
  const sql = getDatabase();
  return sql.begin("ISOLATION LEVEL REPEATABLE READ READ ONLY", async (transaction) => {
    const [workflow] = await transaction`
      SELECT id, name FROM workflows WHERE id = ${workflowId}
    `;
    if (!workflow) return null;

    const runs = await transaction`
      SELECT
        run.id,
        run.status,
        run.input,
        run.created_at,
        run.started_at,
        run.completed_at,
        run.error_code,
        run.error_message,
        (
          SELECT node.node_id
          FROM node_runs AS node
          WHERE node.workflow_run_id = run.id AND node.node_type = 'process.agent'
        ) AS error_node_id,
        version.id AS version_id,
        version.version,
        version.hash
      FROM workflow_runs AS run
      JOIN workflow_definition_versions AS version
        ON version.id = run.workflow_definition_version_id
      WHERE version.workflow_id = ${workflowId}
      ORDER BY run.created_at DESC, run.id DESC
    `;

    return {
      workflow: { id: workflow.id, name: workflow.name },
      runs: runs.map((run) => ({
        id: run.id,
        status: run.status,
        error: runtimeError(run.error_code, run.error_message, run.error_node_id ?? "analyze"),
        createdAt: date(run.created_at),
        startedAt: date(run.started_at),
        completedAt: date(run.completed_at),
        workflowDefinitionVersion: {
          id: run.version_id,
          version: run.version,
          hash: run.hash,
        },
        input: run.input,
      })),
    };
  });
}
