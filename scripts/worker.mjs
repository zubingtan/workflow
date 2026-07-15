import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import postgres from "postgres";
import { runPiAgent } from "./pi-runtime-adapter.mjs";

const port = Number(process.env.WORKER_HEALTH_PORT ?? 4011);
const providerTimeoutMs = Number(process.env.WORKER_PROVIDER_TIMEOUT_MS ?? 30_000);
const leaseMs = Number(process.env.WORKER_LEASE_MS ?? 300_000);
const faultHook = process.env.WORKER_FAULT_HOOK ?? "";
const sweepOnly = process.argv.includes("--sweep-expired-leases");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const terminalErrors = {
  provider_auth_failed: "Provider authentication failed",
  provider_timeout: "Provider request timed out",
  provider_empty_output: "Provider returned empty output",
  worker_lost: "Worker was lost before provider dispatch",
  outcome_unknown: "Provider outcome is unknown",
};

const sql = postgres(databaseUrl, { max: 2 });
const owner = `worker-${randomUUID()}`;
let running = true;
let healthServer = null;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function claimJob() {
  const [job] = await sql`
    WITH candidate AS (
      SELECT id
      FROM queue_jobs
      WHERE status = 'available' AND available_at <= now()
      ORDER BY available_at, created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE queue_jobs AS job
    SET
      status = 'leased',
      lease_owner = ${owner},
      lease_expires_at = now() + (${leaseMs} * interval '1 millisecond')
    FROM candidate
    WHERE job.id = candidate.id
    RETURNING job.id, job.workflow_run_id
  `;
  return job ?? null;
}

async function addEvent(
  transaction,
  runId,
  sequence,
  type,
  {
    nodeRunId = null,
    attemptId = null,
    agentExecutionId = null,
    errorCode = null,
    skipReason = null,
  } = {},
) {
  await transaction`
    INSERT INTO execution_events (
      id,
      workflow_run_id,
      sequence,
      type,
      node_run_id,
      attempt_id,
      agent_execution_id,
      error_code,
      skip_reason
    ) VALUES (
      ${`event-${randomUUID()}`},
      ${runId},
      ${sequence},
      ${type},
      ${nodeRunId},
      ${attemptId},
      ${agentExecutionId},
      ${errorCode},
      ${skipReason}
    )
  `;
}

async function resolveBinding(alias) {
  const bindingFile = process.env.PROVIDER_BINDINGS_FILE;
  if (!bindingFile) throw new Error("Provider bindings are unavailable");
  const document = JSON.parse(await readFile(bindingFile, "utf8"));
  const binding = document.bindings?.[alias];
  if (!binding) throw new Error("Provider binding is unavailable");
  if (![binding.provider, binding.baseUrl, binding.apiKeyEnv, binding.model]
    .every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("Provider binding is unavailable");
  }
  const apiKey = process.env[binding.apiKeyEnv] || null;
  const parameters = typeof binding.parameters?.temperature === "number"
    ? { temperature: binding.parameters.temperature }
    : {};
  return {
    provider: binding.provider,
    baseUrl: binding.baseUrl,
    apiKey,
    model: binding.model,
    parameters,
    snapshot: {
      bindingAlias: alias,
      effectiveProvider: binding.provider,
      effectiveModel: binding.model,
      parameters,
    },
  };
}

async function terminalizeFailure(transaction, facts, code, persistProviderResult) {
  const message = terminalErrors[code];
  await transaction`
    UPDATE agent_executions
    SET
      status = 'failed',
      error_code = ${code},
      error_message = ${message},
      completed_at = now(),
      provider_result_persisted_at = CASE
        WHEN ${persistProviderResult} THEN now()
        ELSE provider_result_persisted_at
      END
    WHERE id = ${facts.agentExecutionId} AND status = 'running'
  `;
  await addEvent(transaction, facts.runId, 7, "agent.execution.failed", {
    nodeRunId: facts.processNodeId,
    attemptId: facts.processAttemptId,
    agentExecutionId: facts.agentExecutionId,
    errorCode: code,
  });
  await transaction`
    UPDATE node_run_attempts
    SET status = 'failed', error_code = ${code}, error_message = ${message}, completed_at = now()
    WHERE id = ${facts.processAttemptId} AND status = 'running'
  `;
  await transaction`
    UPDATE node_runs
    SET status = 'failed', error_code = ${code}, error_message = ${message}, completed_at = now()
    WHERE id = ${facts.processNodeId} AND status = 'running'
  `;
  await addEvent(transaction, facts.runId, 8, "node.attempt.failed", {
    nodeRunId: facts.processNodeId,
    attemptId: facts.processAttemptId,
    errorCode: code,
  });
  await transaction`
    UPDATE node_runs
    SET status = 'skipped', skip_reason = 'upstream_failed', completed_at = now()
    WHERE id = ${facts.outputNodeId} AND status = 'pending'
  `;
  await addEvent(transaction, facts.runId, 9, "node.run.skipped", {
    nodeRunId: facts.outputNodeId,
    skipReason: "upstream_failed",
  });
  await transaction`
    UPDATE workflow_runs
    SET status = 'failed', error_code = ${code}, error_message = ${message}, completed_at = now()
    WHERE id = ${facts.runId} AND status = 'running'
  `;
  const completed = await transaction`
    UPDATE queue_jobs SET status = 'completed', completed_at = now()
    WHERE id = ${facts.jobId} AND status = 'leased'
    RETURNING id
  `;
  if (completed.length !== 1) throw new Error("Queue lease was not retained");
  await addEvent(transaction, facts.runId, 10, "workflow.run.failed", {
    errorCode: code,
  });
}

async function executeJob(job) {
  const [run] = await sql`
    SELECT input->>'prompt' AS prompt
    FROM workflow_runs
    WHERE id = ${job.workflow_run_id}
  `;
  const nodeRows = await sql`
    SELECT id, node_type, agent_definition_version_id, provider_binding_ref
    FROM node_runs
    WHERE workflow_run_id = ${job.workflow_run_id}
    ORDER BY execution_order
  `;
  const nodes = new Map(nodeRows.map((node) => [node.node_type, node]));
  const inputNode = nodes.get("input.prompt");
  const processNode = nodes.get("process.agent");
  const outputNode = nodes.get("output.markdown");
  if (!run || !inputNode || !processNode || !outputNode) {
    throw new Error("Run projection is incomplete");
  }

  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE workflow_runs
      SET status = 'running', started_at = now()
      WHERE id = ${job.workflow_run_id} AND status = 'queued'
    `;
    await addEvent(transaction, job.workflow_run_id, 2, "workflow.run.started");
  });

  const inputAttemptId = `attempt-${randomUUID()}`;
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE node_runs SET status = 'running', started_at = now()
      WHERE id = ${inputNode.id}
    `;
    await transaction`
      INSERT INTO node_run_attempts (id, node_run_id, number, status)
      VALUES (${inputAttemptId}, ${inputNode.id}, 1, 'running')
    `;
    await addEvent(transaction, job.workflow_run_id, 3, "node.attempt.started", {
      nodeRunId: inputNode.id,
      attemptId: inputAttemptId,
    });
  });
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE node_run_attempts SET status = 'succeeded', completed_at = now()
      WHERE id = ${inputAttemptId}
    `;
    await transaction`
      UPDATE node_runs SET status = 'succeeded', completed_at = now()
      WHERE id = ${inputNode.id}
    `;
    await transaction`
      UPDATE node_runs SET status = 'queued' WHERE id = ${processNode.id}
    `;
    await addEvent(transaction, job.workflow_run_id, 4, "node.attempt.succeeded", {
      nodeRunId: inputNode.id,
      attemptId: inputAttemptId,
    });
  });

  let binding = null;
  try {
    binding = await resolveBinding(processNode.provider_binding_ref);
  } catch {
    // Configuration details are intentionally collapsed into the safe terminal auth failure below.
  }
  const providerSnapshot = binding?.snapshot ?? {
    bindingAlias: "unavailable",
    effectiveProvider: "unavailable",
    effectiveModel: "unavailable",
    parameters: {},
  };
  const processAttemptId = `attempt-${randomUUID()}`;
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE node_runs SET status = 'running', started_at = now()
      WHERE id = ${processNode.id}
    `;
    await transaction`
      INSERT INTO node_run_attempts (
        id, node_run_id, number, status, provider_snapshot
      ) VALUES (
        ${processAttemptId}, ${processNode.id}, 1, 'running',
        ${transaction.json(providerSnapshot)}
      )
    `;
    await addEvent(transaction, job.workflow_run_id, 5, "node.attempt.started", {
      nodeRunId: processNode.id,
      attemptId: processAttemptId,
    });
  });

  const agentExecutionId = `agent-execution-${randomUUID()}`;
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO agent_executions (
        id,
        node_run_attempt_id,
        agent_definition_version_id,
        status,
        provider_snapshot
      ) VALUES (
        ${agentExecutionId},
        ${processAttemptId},
        ${processNode.agent_definition_version_id},
        'running',
        ${transaction.json(providerSnapshot)}
      )
    `;
    await addEvent(transaction, job.workflow_run_id, 6, "agent.execution.started", {
      nodeRunId: processNode.id,
      attemptId: processAttemptId,
      agentExecutionId,
    });
  });

  const failureFacts = {
    runId: job.workflow_run_id,
    jobId: job.id,
    processNodeId: processNode.id,
    outputNodeId: outputNode.id,
    processAttemptId,
    agentExecutionId,
  };

  if (binding?.apiKey == null) {
    await sql.begin((transaction) => terminalizeFailure(
      transaction,
      failureFacts,
      "provider_auth_failed",
      false,
    ));
    return;
  }

  if (faultHook === "before_model_request") process.exit(86);
  await sql`
    UPDATE agent_executions SET provider_request_started_at = now()
    WHERE id = ${agentExecutionId} AND status = 'running'
  `;

  let markdown;
  let providerFailure = null;
  try {
    markdown = await runPiAgent({
      prompt: run.prompt,
      provider: binding.provider,
      baseUrl: binding.baseUrl,
      apiKey: binding.apiKey,
      model: binding.model,
      parameters: binding.parameters,
      timeoutMs: providerTimeoutMs,
    });
  } catch (error) {
    if (error && Object.hasOwn(terminalErrors, error.code)) providerFailure = error.code;
    else throw error;
  }

  if (faultHook === "after_model_request_before_persist") process.exit(86);
  if (providerFailure !== null) {
    await sql.begin((transaction) => terminalizeFailure(
      transaction,
      failureFacts,
      providerFailure,
      true,
    ));
    return;
  }

  const outputAttemptId = `attempt-${randomUUID()}`;
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE agent_executions
      SET status = 'succeeded', completed_at = now(), provider_result_persisted_at = now()
      WHERE id = ${agentExecutionId}
    `;
    await addEvent(transaction, job.workflow_run_id, 7, "agent.execution.succeeded", {
      nodeRunId: processNode.id,
      attemptId: processAttemptId,
      agentExecutionId,
    });
    await transaction`
      UPDATE node_run_attempts SET status = 'succeeded', completed_at = now()
      WHERE id = ${processAttemptId}
    `;
    await transaction`
      UPDATE node_runs SET status = 'succeeded', completed_at = now()
      WHERE id = ${processNode.id}
    `;
    await addEvent(transaction, job.workflow_run_id, 8, "node.attempt.succeeded", {
      nodeRunId: processNode.id,
      attemptId: processAttemptId,
    });
    await transaction`
      UPDATE node_runs SET status = 'running', started_at = now()
      WHERE id = ${outputNode.id}
    `;
    await transaction`
      INSERT INTO node_run_attempts (id, node_run_id, number, status)
      VALUES (${outputAttemptId}, ${outputNode.id}, 1, 'running')
    `;
    await addEvent(transaction, job.workflow_run_id, 9, "node.attempt.started", {
      nodeRunId: outputNode.id,
      attemptId: outputAttemptId,
    });
    await transaction`
      UPDATE node_run_attempts SET status = 'succeeded', completed_at = now()
      WHERE id = ${outputAttemptId}
    `;
    await transaction`
      UPDATE node_runs
      SET
        status = 'succeeded',
        output = ${transaction.json({ markdown })},
        completed_at = now()
      WHERE id = ${outputNode.id}
    `;
    await addEvent(transaction, job.workflow_run_id, 10, "node.attempt.succeeded", {
      nodeRunId: outputNode.id,
      attemptId: outputAttemptId,
    });
    await transaction`
      UPDATE workflow_runs SET status = 'succeeded', completed_at = now()
      WHERE id = ${job.workflow_run_id}
    `;
    const completed = await transaction`
      UPDATE queue_jobs SET status = 'completed', completed_at = now()
      WHERE id = ${job.id} AND status = 'leased' AND lease_owner = ${owner}
      RETURNING id
    `;
    if (completed.length !== 1) throw new Error("Queue lease was not retained");
    await addEvent(transaction, job.workflow_run_id, 11, "workflow.run.succeeded");
  });
}

async function sweepExpiredLease() {
  return sql.begin(async (transaction) => {
    const [facts] = await transaction`
      SELECT
        job.id AS job_id,
        job.workflow_run_id AS run_id,
        process_node.id AS process_node_id,
        output_node.id AS output_node_id,
        attempt.id AS process_attempt_id,
        execution.id AS agent_execution_id,
        execution.provider_request_started_at
      FROM queue_jobs AS job
      JOIN workflow_runs AS run ON run.id = job.workflow_run_id
      JOIN node_runs AS process_node
        ON process_node.workflow_run_id = run.id
        AND process_node.node_type = 'process.agent'
      JOIN node_run_attempts AS attempt ON attempt.node_run_id = process_node.id
      JOIN agent_executions AS execution ON execution.node_run_attempt_id = attempt.id
      JOIN node_runs AS output_node
        ON output_node.workflow_run_id = run.id
        AND output_node.node_type = 'output.markdown'
      WHERE job.status = 'leased'
        AND job.lease_expires_at <= now()
        AND run.status = 'running'
        AND process_node.status = 'running'
        AND attempt.status = 'running'
        AND execution.status = 'running'
        AND execution.provider_result_persisted_at IS NULL
        AND output_node.status = 'pending'
      ORDER BY job.lease_expires_at, job.id
      FOR UPDATE OF job SKIP LOCKED
      LIMIT 1
    `;
    if (!facts) return false;
    const code = facts.provider_request_started_at === null ? "worker_lost" : "outcome_unknown";
    await terminalizeFailure(transaction, {
      runId: facts.run_id,
      jobId: facts.job_id,
      processNodeId: facts.process_node_id,
      outputNodeId: facts.output_node_id,
      processAttemptId: facts.process_attempt_id,
      agentExecutionId: facts.agent_execution_id,
    }, code, false);
    return true;
  });
}

async function sweepExpiredLeases() {
  while (await sweepExpiredLease()) {
    // Drain every expired lease available to this one-shot sweeper.
  }
}

async function workLoop() {
  while (running) {
    try {
      await sweepExpiredLeases();
      const job = await claimJob();
      if (job) await executeJob(job);
      else await wait(100);
    } catch {
      console.error("worker job did not complete");
      await wait(100);
    }
  }
}

async function stop() {
  if (!running) return;
  running = false;
  healthServer?.close();
  await sql.end({ timeout: 1 });
}

if (sweepOnly) {
  try {
    await sweepExpiredLeases();
  } catch {
    console.error("expired lease sweep failed");
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 1 });
  }
} else {
  healthServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "live" }));
      return;
    }
    response.writeHead(404).end();
  }).listen(port, "0.0.0.0", () => {
    console.log(`worker health listening on ${port}`);
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  void workLoop();
}
