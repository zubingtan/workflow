import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type postgres from "postgres";
import { applyMigrations, connectDatabase } from "../definition/helpers";

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;
const runRoute = "../../src/app/api/runs/route";
const runDetailRoute = "../../src/app/api/runs/[id]/route";
const snapshot = {
  bindingAlias: "fake-default",
  effectiveProvider: "openai-compatible",
  effectiveModel: "fake-m0",
  parameters: { temperature: 0 },
};

async function createRun(prompt: string) {
  const route = await import(runRoute);
  const response = await route.POST(new Request("http://workflow.test/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workflowDefinitionVersionId: "seed-workflow-v1", input: { prompt } }),
  }));
  expect(response.status).toBe(202);
  return (await response.json()).runId as string;
}

async function getRun(id: string) {
  const route = await import(runDetailRoute);
  return route.GET(new Request(`http://workflow.test/api/runs/${id}`), {
    params: Promise.resolve({ id }),
  });
}

async function sweep() {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/worker.mjs", "--sweep-expired-leases"], {
      cwd: process.cwd(),
      env: { ...process.env, WORKER_PROVIDER_TIMEOUT_MS: "100", WORKER_LEASE_MS: "100" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("expired-lease sweep did not exit"));
    }, 10_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`expired-lease sweep exited ${code}`));
    });
  });
}

databaseSuite("M0-T08/T11 terminal failure persistence", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.PROVIDER_BINDINGS_FILE ??= `${process.cwd()}/config/provider-bindings.example.json`;
    process.env.FAKE_PROVIDER_API_KEY = "PR5_PG_SECRET_DO_NOT_ESCAPE";
    sql = connectDatabase();
    await applyMigrations(sql);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 1 });
  });

  test("004 adds only the accepted nullable failure and dispatch-marker fields", async () => {
    const migration = await sql`SELECT 1 FROM schema_migrations WHERE name = '004_terminal_failures.sql'`;
    expect(migration).toHaveLength(1);
    const expected: Record<string, string[]> = {
      workflow_runs: ["error_code", "error_message"],
      node_runs: ["error_code", "error_message", "skip_reason"],
      node_run_attempts: ["error_code", "error_message"],
      agent_executions: [
        "error_code", "error_message", "provider_request_started_at", "provider_result_persisted_at",
      ],
      execution_events: ["error_code", "skip_reason"],
    };
    for (const [table, columns] of Object.entries(expected)) {
      const rows = await sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
          AND column_name = ANY(${columns})
        ORDER BY column_name
      `;
      expect(rows.map((row) => row.column_name)).toEqual([...columns].sort());
      expect(rows.every((row) => row.is_nullable === "YES")).toBe(true);
    }
  });

  test("004 rejects invalid terminal values and preserves both legal dispatch-marker states", async () => {
    const runId = await createRun(`schema-constraints-${randomUUID()}`);
    const [processNode] = await sql`
      SELECT id, agent_definition_version_id
      FROM node_runs
      WHERE workflow_run_id=${runId} AND node_type='process.agent'
    `;
    const [outputNode] = await sql`
      SELECT id FROM node_runs
      WHERE workflow_run_id=${runId} AND node_type='output.markdown'
    `;
    const attemptId = `attempt-${randomUUID()}`;
    const executionId = `agent-execution-${randomUUID()}`;
    await sql`
      INSERT INTO node_run_attempts (id,node_run_id,number,status,provider_snapshot)
      VALUES (${attemptId},${processNode.id},1,'running',${sql.json(snapshot)})
    `;
    await sql`
      INSERT INTO agent_executions (
        id,node_run_attempt_id,agent_definition_version_id,status,provider_snapshot,
        provider_request_started_at,provider_result_persisted_at
      ) VALUES (
        ${executionId},${attemptId},${processNode.agent_definition_version_id},'running',
        ${sql.json(snapshot)},NULL,NULL
      )
    `;

    await expect(sql`UPDATE workflow_runs SET error_code='invalid_error_code' WHERE id=${runId}`).rejects.toThrow();
    await expect(sql`
      UPDATE node_runs
      SET status='skipped',skip_reason='invalid_skip_reason',completed_at=now()
      WHERE id=${outputNode.id}
    `).rejects.toThrow();
    await expect(sql`
      UPDATE agent_executions
      SET provider_result_persisted_at=now()
      WHERE id=${executionId}
    `).rejects.toThrow();

    const [beforeDispatch] = await sql`
      SELECT provider_request_started_at,provider_result_persisted_at
      FROM agent_executions WHERE id=${executionId}
    `;
    expect(beforeDispatch).toEqual({
      provider_request_started_at: null,
      provider_result_persisted_at: null,
    });
    await sql`UPDATE agent_executions SET provider_request_started_at=now() WHERE id=${executionId}`;
    const [afterDispatch] = await sql`
      SELECT provider_request_started_at,provider_result_persisted_at
      FROM agent_executions WHERE id=${executionId}
    `;
    expect(afterDispatch.provider_request_started_at).toBeInstanceOf(Date);
    expect(afterDispatch.provider_result_persisted_at).toBeNull();
  });

  async function seedExpiredLease(requestStarted: boolean) {
    const runId = await createRun(`expired-lease-${randomUUID()}`);
    const nodes = await sql`
      SELECT id, node_type, agent_definition_version_id
      FROM node_runs WHERE workflow_run_id = ${runId} ORDER BY execution_order
    `;
    const [job] = await sql`SELECT id FROM queue_jobs WHERE workflow_run_id = ${runId}`;
    const inputAttempt = `attempt-${randomUUID()}`;
    const processAttempt = `attempt-${randomUUID()}`;
    const execution = `agent-execution-${randomUUID()}`;
    await sql.begin(async (transaction) => {
      await transaction`UPDATE workflow_runs SET status = 'running', started_at = now() WHERE id = ${runId}`;
      await transaction`UPDATE node_runs SET status = 'succeeded', started_at = now(), completed_at = now() WHERE id = ${nodes[0].id}`;
      await transaction`INSERT INTO node_run_attempts (id,node_run_id,number,status,started_at,completed_at) VALUES (${inputAttempt},${nodes[0].id},1,'succeeded',now(),now())`;
      await transaction`UPDATE node_runs SET status = 'running', started_at = now() WHERE id = ${nodes[1].id}`;
      await transaction`INSERT INTO node_run_attempts (id,node_run_id,number,status,provider_snapshot) VALUES (${processAttempt},${nodes[1].id},1,'running',${transaction.json(snapshot)})`;
      await transaction`
        INSERT INTO agent_executions (
          id,node_run_attempt_id,agent_definition_version_id,status,provider_snapshot,provider_request_started_at
        ) VALUES (
          ${execution},${processAttempt},${nodes[1].agent_definition_version_id},'running',
          ${transaction.json(snapshot)},${requestStarted ? new Date() : null}
        )
      `;
      await transaction`UPDATE queue_jobs SET status='leased',lease_owner='expired-test-worker',lease_expires_at=now()-interval '1 second' WHERE id=${job.id}`;
      for (const event of [
        [2, "workflow.run.started", null, null, null],
        [3, "node.attempt.started", nodes[0].id, inputAttempt, null],
        [4, "node.attempt.succeeded", nodes[0].id, inputAttempt, null],
        [5, "node.attempt.started", nodes[1].id, processAttempt, null],
        [6, "agent.execution.started", nodes[1].id, processAttempt, execution],
      ] as const) {
        await transaction`
          INSERT INTO execution_events (id,workflow_run_id,sequence,type,node_run_id,attempt_id,agent_execution_id)
          VALUES (${`event-${randomUUID()}`},${runId},${event[0]},${event[1]},${event[2]},${event[3]},${event[4]})
        `;
      }
    });
    return runId;
  }

  async function terminalFacts(runId: string) {
    const [run] = await sql`SELECT * FROM workflow_runs WHERE id=${runId}`;
    const nodes = await sql`
      SELECT * FROM node_runs
      WHERE workflow_run_id=${runId}
      ORDER BY execution_order
    `;
    const attempts = await sql`
      SELECT attempt.*,node.node_id,node.execution_order
      FROM node_run_attempts attempt
      JOIN node_runs node ON node.id=attempt.node_run_id
      WHERE node.workflow_run_id=${runId}
      ORDER BY node.execution_order
    `;
    const executions = await sql`
      SELECT execution.*,node.node_id,node.execution_order
      FROM agent_executions execution
      JOIN node_run_attempts attempt ON attempt.id=execution.node_run_attempt_id
      JOIN node_runs node ON node.id=attempt.node_run_id
      WHERE node.workflow_run_id=${runId}
      ORDER BY node.execution_order
    `;
    const events = await sql`
      SELECT * FROM execution_events
      WHERE workflow_run_id=${runId}
      ORDER BY sequence
    `;
    const jobs = await sql`SELECT * FROM queue_jobs WHERE workflow_run_id=${runId} ORDER BY id`;
    return { run, nodes, attempts, executions, events, jobs };
  }

  test.each([
    [false, "worker_lost", "Worker was lost before provider dispatch"],
    [true, "outcome_unknown", "Provider outcome is unknown"],
  ] as const)("expired lease marker=%s converges once to %s", async (started, code, message) => {
    const runId = await seedExpiredLease(started);
    const firstSweep = await sweep();
    expect(`${firstSweep.stdout}${firstSweep.stderr}`.includes("PR5_PG_SECRET_DO_NOT_ESCAPE")).toBe(false);
    const first = await terminalFacts(runId);
    expect(first.run).toMatchObject({ status: "failed", error_code: code, error_message: message });
    expect(first.run.started_at).toBeInstanceOf(Date);
    expect(first.run.completed_at).toBeInstanceOf(Date);
    expect(first.nodes.map((node) => [node.status, node.error_code, node.error_message, node.skip_reason])).toEqual([
      ["succeeded", null, null, null],
      ["failed", code, message, null],
      ["skipped", null, null, "upstream_failed"],
    ]);
    expect(first.nodes).toHaveLength(3);
    expect(first.nodes[0].started_at).toBeInstanceOf(Date);
    expect(first.nodes[0].completed_at).toBeInstanceOf(Date);
    expect(first.nodes[1].started_at).toBeInstanceOf(Date);
    expect(first.nodes[1].completed_at).toBeInstanceOf(Date);
    expect(first.nodes[2].started_at).toBeNull();
    expect(first.nodes[2].completed_at).toBeInstanceOf(Date);
    expect(first.nodes[2].output).toBeNull();
    expect(first.attempts).toHaveLength(2);
    expect(first.attempts[0]).toMatchObject({ status: "succeeded", error_code: null, error_message: null });
    expect(first.attempts[0].started_at).toBeInstanceOf(Date);
    expect(first.attempts[0].completed_at).toBeInstanceOf(Date);
    expect(first.attempts[1]).toMatchObject({ status: "failed", error_code: code, error_message: message });
    expect(first.attempts[1].started_at).toBeInstanceOf(Date);
    expect(first.attempts[1].completed_at).toBeInstanceOf(Date);
    expect(first.executions).toHaveLength(1);
    expect(first.executions[0]).toMatchObject({ status: "failed", error_code: code, error_message: message });
    expect(first.executions[0].started_at).toBeInstanceOf(Date);
    expect(first.executions[0].completed_at).toBeInstanceOf(Date);
    expect(first.executions[0].provider_request_started_at).toEqual(started ? expect.any(Date) : null);
    expect(first.executions[0].provider_result_persisted_at).toBeNull();
    expect(first.jobs).toHaveLength(1);
    expect(first.jobs[0]).toMatchObject({ status: "completed", lease_owner: "expired-test-worker" });
    expect(first.jobs[0].available_at).toBeInstanceOf(Date);
    expect(first.jobs[0].lease_expires_at).toBeInstanceOf(Date);
    expect(first.jobs[0].created_at).toBeInstanceOf(Date);
    expect(first.jobs[0].completed_at).toBeInstanceOf(Date);
    expect(first.events).toHaveLength(10);
    expect(first.events.slice(6).map((event) => [event.sequence,event.type,event.error_code,event.skip_reason])).toEqual([
      [7,"agent.execution.failed",code,null],
      [8,"node.attempt.failed",code,null],
      [9,"node.run.skipped",null,"upstream_failed"],
      [10,"workflow.run.failed",code,null],
    ]);
    expect(first.events.slice(6).map((event) => ({
      sequence: event.sequence,
      node_run_id: event.node_run_id,
      attempt_id: event.attempt_id,
      agent_execution_id: event.agent_execution_id,
    }))).toEqual([
      { sequence: 7, node_run_id: first.nodes[1].id, attempt_id: first.attempts[1].id, agent_execution_id: first.executions[0].id },
      { sequence: 8, node_run_id: first.nodes[1].id, attempt_id: first.attempts[1].id, agent_execution_id: null },
      { sequence: 9, node_run_id: first.nodes[2].id, attempt_id: null, agent_execution_id: null },
      { sequence: 10, node_run_id: null, attempt_id: null, agent_execution_id: null },
    ]);

    const response = await getRun(runId);
    const body = await response.json();
    const expectedError = { code, message, nodeId: "analyze" };
    expect(body.run.error).toEqual(expectedError);
    expect(body.run.nodes[1].error).toEqual(expectedError);
    expect(body.run.nodes[1].attempt.error).toEqual(expectedError);
    expect(body.run.nodes[1].attempt.agentExecution.error).toEqual(expectedError);
    expect(body.run.nodes[2]).toMatchObject({ status: "skipped", error: null, skipReason: "upstream_failed", attempt: null, output: null });

    const timeline = body.run.timeline;
    expect(Array.isArray(timeline)).toBe(true);
    expect(timeline.map((event: Record<string, unknown>) => ({
      sequence: event.sequence,
      type: event.type,
      nodeId: event.nodeId ?? null,
      code: event.code ?? null,
      reason: event.reason ?? null,
      artifact: event.artifact ?? null,
    }))).toEqual([
      { sequence: 1, type: "workflow.run.queued", nodeId: null, code: null, reason: null, artifact: null },
      { sequence: 2, type: "workflow.run.started", nodeId: null, code: null, reason: null, artifact: null },
      { sequence: 3, type: "node.attempt.started", nodeId: "prompt", code: null, reason: null, artifact: null },
      { sequence: 4, type: "node.attempt.succeeded", nodeId: "prompt", code: null, reason: null, artifact: null },
      { sequence: 5, type: "node.attempt.started", nodeId: "analyze", code: null, reason: null, artifact: null },
      { sequence: 6, type: "agent.execution.started", nodeId: "analyze", code: null, reason: null, artifact: null },
      { sequence: 7, type: "agent.execution.failed", nodeId: "analyze", code, reason: null, artifact: null },
      { sequence: 8, type: "node.attempt.failed", nodeId: "analyze", code, reason: null, artifact: null },
      { sequence: 9, type: "node.run.skipped", nodeId: "result", code: null, reason: "upstream_failed", artifact: null },
      { sequence: 10, type: "workflow.run.failed", nodeId: null, code, reason: null, artifact: null },
    ]);
    const allowedTimelineKeys = new Set([
      "sequence", "type", "occurredAt", "nodeId", "code", "reason", "artifact",
    ]);
    for (const event of timeline as Array<Record<string, unknown>>) {
      expect(Object.keys(event).every((key) => allowedTimelineKeys.has(key))).toBe(true);
      expect(event.sequence).toEqual(expect.any(Number));
      expect(event.type).toEqual(expect.any(String));
      expect(event.occurredAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(event.occurredAt as string))).toBe(false);
    }
    const timelineText = JSON.stringify(timeline);
    for (const forbidden of [
      body.run.input.prompt,
      "fake-default",
      "openai-compatible",
      "fake-m0",
      process.env.FAKE_PROVIDER_API_KEY!,
      "payload",
      "providerSnapshot",
      "agentExecutionId",
      "attemptId",
      "nodeRunId",
    ]) {
      expect(timelineText).not.toContain(forbidden);
    }

    await sweep();
    expect(await terminalFacts(runId)).toEqual(first);
    expect(first.jobs.filter((job) => job.status === "available")).toHaveLength(0);
    expect(first.jobs.filter((job) => job.status === "completed")).toHaveLength(1);
    await expect(sql`UPDATE execution_events SET error_code=error_code WHERE workflow_run_id=${runId} AND sequence=10`).rejects.toThrow();
    await expect(sql`DELETE FROM execution_events WHERE workflow_run_id=${runId} AND sequence=10`).rejects.toThrow();
  });
});
