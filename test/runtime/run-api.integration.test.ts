import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type postgres from "postgres";
import {
  applyMigrations,
  connectDatabase,
  importWorkflow,
  validDefinition,
} from "../definition/helpers";

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;
const runRoute = "../../src/app/api/runs/route";
const runDetailRoute = "../../src/app/api/runs/[id]/route";
const workflowRunsRoute = "../../src/app/api/workflows/[id]/runs/route";

async function createRun(body: unknown) {
  const route = await import(runRoute);
  return route.POST(new Request("http://workflow.test/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function getRun(id: string) {
  const route = await import(runDetailRoute);
  return route.GET(new Request(`http://workflow.test/api/runs/${id}`), {
    params: Promise.resolve({ id }),
  });
}

async function getWorkflowRuns(id: string) {
  const route = await import(workflowRunsRoute);
  return route.GET(new Request(`http://workflow.test/api/workflows/${id}/runs`), {
    params: Promise.resolve({ id }),
  });
}

function definitionWithVersionedNodeIds(name: string, version: "v1" | "v2") {
  const definition = validDefinition(name);
  const [prompt, analyze, result] = definition.spec.nodes;
  prompt.id = `prompt-${version}`;
  analyze.id = `analyze-${version}`;
  result.id = `result-${version}`;
  definition.spec.edges[0].from = prompt.id;
  definition.spec.edges[0].to = analyze.id;
  definition.spec.edges[1].from = analyze.id;
  definition.spec.edges[1].to = result.id;
  return definition;
}

databaseSuite("M0-T05 asynchronous Run API", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    process.env.PROVIDER_BINDINGS_FILE ??= `${process.cwd()}/config/provider-bindings.example.json`;
    process.env.FAKE_PROVIDER_API_KEY = "PR4_API_SECRET_DO_NOT_LEAK";
    sql = connectDatabase();
    await applyMigrations(sql);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await sql?.end({ timeout: 1 });
  });

  test.each([
    ["missing Definition Version", (versionId: string, prompt: string) => ({ input: { prompt } }), "workflowDefinitionVersionId"],
    ["empty Definition Version", (_versionId: string, prompt: string) => ({ workflowDefinitionVersionId: "", input: { prompt } }), "workflowDefinitionVersionId"],
    ["missing prompt", (versionId: string) => ({ workflowDefinitionVersionId: versionId, input: {} }), "input.prompt"],
    ["empty prompt", (versionId: string) => ({ workflowDefinitionVersionId: versionId, input: { prompt: "" } }), "input.prompt"],
    ["top-level extra", (versionId: string, prompt: string) => ({ workflowDefinitionVersionId: versionId, input: { prompt }, extra: true }), "extra"],
    ["input extra", (versionId: string, prompt: string) => ({ workflowDefinitionVersionId: versionId, input: { prompt, extra: true } }), "input.extra"],
  ])("rejects %s at %s", async (_label, buildBody, path) => {
    const imported = await importWorkflow(validDefinition(`run-invalid-${randomUUID()}`));
    const versionId = (await imported.json()).workflowDefinitionVersion.id;
    const prompt = `invalid-${randomUUID()}`;
    const body = buildBody(versionId, prompt);
    const response = await createRun(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: "validation_error",
      message: expect.any(String),
      path,
      nodeId: null,
    });
    expect((await sql`
      SELECT count(*)::int AS count
      FROM workflow_runs
      WHERE workflow_definition_version_id = ${versionId}
         OR input->>'prompt' = ${prompt}
    `)[0].count).toBe(0);
  });

  test("unknown immutable Definition Version returns the fixed 404", async () => {
    const missingVersionId = `missing-${randomUUID()}`;
    const prompt = `missing-version-${randomUUID()}`;
    const response = await createRun({
      workflowDefinitionVersionId: missingVersionId,
      input: { prompt },
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: "not_found",
      message: "Workflow definition version not found",
    });
    expect((await sql`
      SELECT count(*)::int AS count
      FROM workflow_runs
      WHERE workflow_definition_version_id = ${missingVersionId}
         OR input->>'prompt' = ${prompt}
    `)[0].count).toBe(0);
  });

  test("POST returns exact 202, dispatches no provider call, and commits the queued facts together", async () => {
    const imported = await importWorkflow(validDefinition(`run-create-${randomUUID()}`));
    const definition = (await imported.json()).workflowDefinitionVersion;
    const providerCall = vi.spyOn(globalThis, "fetch");

    const response = await createRun({
      workflowDefinitionVersionId: definition.id,
      input: { prompt: "  preserve my prompt exactly  " },
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({ runId: expect.any(String), status: "queued" });
    expect(Object.keys(body)).toEqual(["runId", "status"]);
    expect(providerCall).not.toHaveBeenCalled();

    const [facts] = await sql`
      SELECT
        run.status,
        run.workflow_definition_version_id,
        run.input,
        (SELECT count(*)::int FROM node_runs node WHERE node.workflow_run_id = run.id) AS nodes,
        (SELECT count(*)::int FROM queue_jobs job WHERE job.workflow_run_id = run.id AND job.status = 'available') AS jobs,
        (SELECT count(*)::int FROM execution_events event WHERE event.workflow_run_id = run.id AND event.sequence = 1 AND event.type = 'workflow.run.queued') AS events
      FROM workflow_runs run
      WHERE run.id = ${body.runId}
    `;
    expect(facts).toEqual({
      status: "queued",
      workflow_definition_version_id: definition.id,
      input: { prompt: "  preserve my prompt exactly  " },
      nodes: 3,
      jobs: 1,
      events: 1,
    });
  });

  test("a failed queue insert rolls back Run, Node Runs, and the first event", async () => {
    const imported = await importWorkflow(validDefinition(`run-atomic-${randomUUID()}`));
    const definition = (await imported.json()).workflowDefinitionVersion;
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION pr4_reject_queue_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PR4 forced queue insert failure'; END $$;
      CREATE TRIGGER pr4_reject_queue_insert
      BEFORE INSERT ON queue_jobs FOR EACH ROW EXECUTE FUNCTION pr4_reject_queue_insert();
    `);
    try {
      const response = await createRun({
        workflowDefinitionVersionId: definition.id,
        input: { prompt: "must roll back" },
      });
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect((await sql`
        SELECT count(*)::int AS count
        FROM workflow_runs
        WHERE workflow_definition_version_id = ${definition.id}
      `)[0].count).toBe(0);
      const [related] = await sql`
        SELECT
          (SELECT count(*)::int
           FROM node_runs node
           JOIN workflow_runs run ON run.id = node.workflow_run_id
           WHERE run.workflow_definition_version_id = ${definition.id}) AS nodes,
          (SELECT count(*)::int
           FROM execution_events event
           JOIN workflow_runs run ON run.id = event.workflow_run_id
           WHERE run.workflow_definition_version_id = ${definition.id}) AS events,
          (SELECT count(*)::int
           FROM queue_jobs job
           JOIN workflow_runs run ON run.id = job.workflow_run_id
           WHERE run.workflow_definition_version_id = ${definition.id}) AS jobs
      `;
      expect(related).toEqual({ nodes: 0, events: 0, jobs: 0 });
    } finally {
      await sql.unsafe("DROP TRIGGER IF EXISTS pr4_reject_queue_insert ON queue_jobs; DROP FUNCTION IF EXISTS pr4_reject_queue_insert();");
    }
  });

  test("queued detail has fixed node order/statuses and null attempts", async () => {
    const imported = await importWorkflow(validDefinition(`run-detail-${randomUUID()}`));
    const importedBody = await imported.json();
    const prompt = "Explain this incident";
    const created = await createRun({
      workflowDefinitionVersionId: importedBody.workflowDefinitionVersion.id,
      input: { prompt },
    });
    const { runId } = await created.json();
    const response = await getRun(runId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Object.keys(body).sort()).toEqual(["run"]);
    expect(Object.keys(body.run).sort()).toEqual([
      "completedAt", "createdAt", "error", "id", "input", "nodes", "startedAt", "status",
      "workflow", "workflowDefinitionVersion",
    ]);
    expect(Object.keys(body.run.workflow).sort()).toEqual(["id", "name"]);
    expect(Object.keys(body.run.workflowDefinitionVersion).sort()).toEqual([
      "definition", "hash", "id", "version",
    ]);
    expect(Object.keys(body.run.input).sort()).toEqual(["prompt"]);
    expect(body.run).toMatchObject({
      id: runId,
      status: "queued",
      error: null,
      createdAt: expect.any(String),
      startedAt: null,
      completedAt: null,
      workflow: importedBody.workflow,
      workflowDefinitionVersion: {
        id: importedBody.workflowDefinitionVersion.id,
        version: importedBody.workflowDefinitionVersion.version,
        hash: importedBody.workflowDefinitionVersion.hash,
        definition: importedBody.workflowDefinitionVersion.definition,
      },
      input: { prompt },
    });
    expect(JSON.stringify(body)).not.toContain(process.env.FAKE_PROVIDER_API_KEY!);
    const nodeKeys = [
      "agentDefinitionVersion", "attempt", "error", "id", "nodeId", "output",
      "providerBindingRef", "skipReason", "status", "type",
    ];
    expect(body.run.nodes.every((node: Record<string, unknown>) =>
      JSON.stringify(Object.keys(node).sort()) === JSON.stringify(nodeKeys))).toBe(true);
    expect(Object.keys(body.run.nodes[1].agentDefinitionVersion).sort()).toEqual(["hash", "id", "version"]);
    expect(body.run.nodes).toEqual([
      expect.objectContaining({
        id: expect.any(String), nodeId: "prompt", type: "input.prompt", status: "queued",
        error: null, skipReason: null, agentDefinitionVersion: null,
        providerBindingRef: null, output: null, attempt: null,
      }),
      expect.objectContaining({
        id: expect.any(String), nodeId: "analyze", type: "process.agent", status: "pending",
        error: null, skipReason: null,
        agentDefinitionVersion: {
          id: "seed-agent-v1", version: 1, hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        providerBindingRef: "fake-default", output: null, attempt: null,
      }),
      expect.objectContaining({
        id: expect.any(String), nodeId: "result", type: "output.markdown", status: "pending",
        error: null, skipReason: null, agentDefinitionVersion: null,
        providerBindingRef: null, output: null, attempt: null,
      }),
    ]);
  });

  test("Run detail remains pinned to the original immutable Definition after a later version is imported", async () => {
    const name = `run-detail-history-${randomUUID()}`;
    const firstDefinition = definitionWithVersionedNodeIds(name, "v1");
    const firstImport = await importWorkflow(firstDefinition);
    const first = await firstImport.json();
    const created = await createRun({
      workflowDefinitionVersionId: first.workflowDefinitionVersion.id,
      input: { prompt: "original prompt" },
    });
    expect(created.status).toBe(202);
    const { runId } = await created.json();

    const secondDefinition = definitionWithVersionedNodeIds(name, "v2");
    const secondImport = await importWorkflow(secondDefinition);
    const second = await secondImport.json();
    expect(second.workflowDefinitionVersion.version).toBe(2);

    const detail = await getRun(runId);
    expect(detail.status).toBe(200);
    expect((await detail.json()).run.workflowDefinitionVersion).toEqual({
      id: first.workflowDefinitionVersion.id,
      version: 1,
      hash: first.workflowDefinitionVersion.hash,
      definition: firstDefinition,
    });
  });

  test("history remains pinned to the original Definition Version and missing resources 404", async () => {
    const name = `run-history-${randomUUID()}`;
    const firstImport = await importWorkflow(validDefinition(name));
    const first = await firstImport.json();
    const created = await createRun({
      workflowDefinitionVersionId: first.workflowDefinitionVersion.id,
      input: { prompt: "original prompt" },
    });
    const { runId } = await created.json();
    const secondImport = await importWorkflow(validDefinition(name));
    const second = await secondImport.json();
    expect(second.workflowDefinitionVersion.version).toBe(2);

    const response = await getWorkflowRuns(first.workflow.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      workflow: first.workflow,
      runs: [{
        id: runId,
        status: "queued",
        error: null,
        createdAt: expect.any(String),
        startedAt: null,
        completedAt: null,
        workflowDefinitionVersion: {
          id: first.workflowDefinitionVersion.id,
          version: 1,
          hash: first.workflowDefinitionVersion.hash,
        },
        input: { prompt: "original prompt" },
      }],
    });

    const missingRun = await getRun(`missing-${randomUUID()}`);
    expect(missingRun.status).toBe(404);
    expect(await missingRun.json()).toEqual({ code: "not_found", message: "Run not found" });
    const missingWorkflow = await getWorkflowRuns(`missing-${randomUUID()}`);
    expect(missingWorkflow.status).toBe(404);
    expect(await missingWorkflow.json()).toEqual({ code: "not_found", message: "Workflow not found" });
  });
});
