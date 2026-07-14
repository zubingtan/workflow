import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import postgres from "postgres";
import { runPiAgent } from "./pi-runtime-adapter.mjs";

const port = Number(process.env.WORKER_HEALTH_PORT ?? 4011);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 2 });
const owner = `worker-${randomUUID()}`;
let running = true;

const healthServer = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health/live") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "live" }));
    return;
  }
  response.writeHead(404).end();
}).listen(port, "0.0.0.0", () => {
  console.log(`worker health listening on ${port}`);
});

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
      lease_expires_at = now() + interval '5 minutes'
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
  { nodeRunId = null, attemptId = null, agentExecutionId = null } = {},
) {
  await transaction`
    INSERT INTO execution_events (
      id,
      workflow_run_id,
      sequence,
      type,
      node_run_id,
      attempt_id,
      agent_execution_id
    ) VALUES (
      ${`event-${randomUUID()}`},
      ${runId},
      ${sequence},
      ${type},
      ${nodeRunId},
      ${attemptId},
      ${agentExecutionId}
    )
  `;
}

async function resolveBinding(alias) {
  const bindingFile = process.env.PROVIDER_BINDINGS_FILE;
  if (!bindingFile) throw new Error("Provider bindings are unavailable");
  const document = JSON.parse(await readFile(bindingFile, "utf8"));
  const binding = document.bindings?.[alias];
  if (!binding) throw new Error("Provider binding is unavailable");
  const apiKey = process.env[binding.apiKeyEnv];
  if (!apiKey) throw new Error("Provider credential is unavailable");
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

  const binding = await resolveBinding(processNode.provider_binding_ref);
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
        ${transaction.json(binding.snapshot)}
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
        ${transaction.json(binding.snapshot)}
      )
    `;
    await addEvent(transaction, job.workflow_run_id, 6, "agent.execution.started", {
      nodeRunId: processNode.id,
      attemptId: processAttemptId,
      agentExecutionId,
    });
  });

  const markdown = await runPiAgent({
    prompt: run.prompt,
    provider: binding.provider,
    baseUrl: binding.baseUrl,
    apiKey: binding.apiKey,
    model: binding.model,
    parameters: binding.parameters,
  });

  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE agent_executions SET status = 'succeeded', completed_at = now()
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
    await transaction`
      UPDATE node_runs SET status = 'queued' WHERE id = ${outputNode.id}
    `;
    await addEvent(transaction, job.workflow_run_id, 8, "node.attempt.succeeded", {
      nodeRunId: processNode.id,
      attemptId: processAttemptId,
    });
  });

  const outputAttemptId = `attempt-${randomUUID()}`;
  await sql.begin(async (transaction) => {
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
  });

  await sql.begin(async (transaction) => {
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

async function workLoop() {
  while (running) {
    try {
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
  healthServer.close();
  await sql.end({ timeout: 1 });
}

process.once("SIGTERM", stop);
process.once("SIGINT", stop);
void workLoop();
