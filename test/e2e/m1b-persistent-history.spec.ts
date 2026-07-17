import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/compose-stack";

type WorkflowFixture = {
  metadata: { name: string };
  spec: {
    nodes: Array<{
      id: string;
      type: "input.prompt" | "process.agent" | "output.markdown";
      config: Record<string, unknown>;
    }>;
    edges: Array<{
      from: string;
      to: string;
      mapping: Array<{ from: string; to: string }>;
    }>;
  };
};

const validFixture = JSON.parse(readFileSync(
  "test/definition/fixtures/valid-workflow.json",
  "utf8",
)) as WorkflowFixture;

const v1Nodes = [
  { id: "prompt-v1", label: "Input prompt" },
  { id: "analyze-v1", label: "Agent analysis" },
  { id: "result-v1", label: "Markdown output" },
] as const;

type RunDetail = {
  run: {
    id: string;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    nodes: Array<{
      nodeId: string;
      status: string;
      output: { markdown: string } | null;
      attempt: {
        id: string;
        status: string;
        startedAt: string | null;
        completedAt: string | null;
        agentExecution: {
          id: string;
          status: string;
          startedAt: string | null;
          completedAt: string | null;
        } | null;
      } | null;
    }>;
  };
};

function workflowDefinition(name: string, version: "v1" | "v2") {
  const definition = structuredClone(validFixture);
  definition.metadata.name = name;
  definition.spec.nodes = definition.spec.nodes.map((node) => ({
    ...node,
    id: `${node.id}-${version}`,
  }));
  definition.spec.edges = definition.spec.edges.map((edge) => ({
    ...edge,
    from: `${edge.from}-${version}`,
    to: `${edge.to}-${version}`,
  }));
  return definition;
}

async function importWorkflow(page: Page, definition: WorkflowFixture) {
  await page.getByRole("button", { name: "Import workflow" }).click();
  await page.getByLabel("Workflow JSON").fill(JSON.stringify(definition, null, 2));
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && candidate.url().endsWith("/api/workflows/import"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  return response;
}

async function createRun(page: Page, prompt: string) {
  await page.getByRole("button", { name: "Run workflow" }).click();
  const dialog = page.getByRole("dialog", { name: "Run workflow" });
  await dialog.getByLabel("Prompt").fill(prompt);
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && candidate.url().endsWith("/api/runs"));
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(202);
  const body = await created.json() as { runId: string; status: string };
  expect(body).toEqual({ runId: expect.stringMatching(/^run-/u), status: "queued" });
  return body.runId;
}

async function getRunDetail(page: Page, appUrl: string, runId: string) {
  const response = await page.request.get(`${appUrl}/api/runs/${runId}`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<RunDetail>;
}

function persistentExecution(detail: RunDetail) {
  const processNodes = detail.run.nodes.filter((node) => node.nodeId === "analyze-v1");
  const outputNodes = detail.run.nodes.filter((node) => node.nodeId === "result-v1");
  expect(processNodes).toHaveLength(1);
  expect(outputNodes).toHaveLength(1);
  const process = processNodes[0];
  const output = outputNodes[0];
  expect(process.attempt).not.toBeNull();
  expect(process.attempt?.agentExecution).not.toBeNull();

  return {
    run: {
      id: detail.run.id,
      status: detail.run.status,
      startedAt: detail.run.startedAt,
      completedAt: detail.run.completedAt,
    },
    process: {
      nodeId: process.nodeId,
      status: process.status,
      attempt: {
        id: process.attempt!.id,
        status: process.attempt!.status,
        startedAt: process.attempt!.startedAt,
        completedAt: process.attempt!.completedAt,
        execution: {
          id: process.attempt!.agentExecution!.id,
          status: process.attempt!.agentExecution!.status,
          startedAt: process.attempt!.agentExecution!.startedAt,
          completedAt: process.attempt!.agentExecution!.completedAt,
        },
      },
    },
    output: {
      nodeId: output.nodeId,
      status: output.status,
      markdown: output.output?.markdown,
    },
  };
}

function canvas(page: Page) {
  return page.getByRole("region", { name: "Workflow canvas" });
}

function canvasNode(page: Page, node: typeof v1Nodes[number]) {
  return canvas(page).getByRole("button", { name: `${node.label} (${node.id})`, exact: true });
}

async function expectPersistentV1Run(page: Page) {
  await expect(page.getByRole("region", { name: "Run facts" })).toContainText("Definition v1");
  const renderer = canvas(page).locator(".flowgram-editor");
  await expect(renderer).toBeVisible();
  await expect(renderer.locator(".flowgram-rendered-node")).toHaveCount(v1Nodes.length);

  const productNodeIds = await renderer.locator("[data-product-node-id]").evaluateAll((elements) =>
    [...new Set(elements.map((element) => element.getAttribute("data-product-node-id")))].sort(),
  );
  expect(productNodeIds).toEqual(v1Nodes.map((node) => node.id).sort());
  await expect(renderer.locator('[data-product-node-id$="-v2"]')).toHaveCount(0);

  for (const node of v1Nodes) {
    await expect(canvasNode(page, node).getByText("Succeeded", { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Output" })).toContainText("Fake provider response");
}

test("M1-B — keeps a historical Run pinned to its Definition across a Compose restart", async ({
  page,
  stack,
  evidence,
}) => {
  const workflowName = `M1-B persistent history ${Date.now()}`;
  const correlation = `m1b-persistent-${Date.now()}`;
  const prompt = `Investigate ${correlation}`;

  await stack.configureProvider(correlation, "success");
  await page.goto(stack.appUrl);
  const firstImport = await importWorkflow(page, workflowDefinition(workflowName, "v1"));
  expect(firstImport.status()).toBe(201);
  await expect(page.getByRole("heading", { name: workflowName, level: 1 })).toBeVisible();
  await expect(page.getByText("Definition v1", { exact: true })).toBeVisible();

  const runId = await createRun(page, prompt);
  await stack.startWorker();
  for (const node of v1Nodes) {
    await expect(canvasNode(page, node).getByText("Succeeded", { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Output" })).toContainText("Fake provider response");
  expect(await stack.providerCalls(correlation)).toBe(1);

  await page.goto(stack.appUrl);
  const secondImport = await importWorkflow(page, workflowDefinition(workflowName, "v2"));
  expect(secondImport.status()).toBe(201);
  const importedV2 = await secondImport.json() as { workflow: { id: string } };
  const workflowId = importedV2.workflow.id;
  await expect(page.getByText("Definition v2", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "History", exact: true }).click();
  const historyRow = page.getByRole("row").filter({ hasText: runId });
  await expect(historyRow).toContainText("Definition v1");
  await historyRow.getByRole("link", { name: runId }).click();
  await expectPersistentV1Run(page);
  const beforeRestart = persistentExecution(await getRunDetail(page, stack.appUrl, runId));

  await page.goto("about:blank");
  await stack.restartAll();
  await page.goto(`${stack.appUrl}/workflows/${workflowId}`);
  await page.getByRole("link", { name: "History", exact: true }).click();
  const restartedHistoryRow = page.getByRole("row").filter({ hasText: runId });
  await expect(restartedHistoryRow).toContainText("Definition v1");
  await restartedHistoryRow.getByRole("link", { name: runId }).click();
  await expectPersistentV1Run(page);
  expect(persistentExecution(await getRunDetail(page, stack.appUrl, runId))).toEqual(beforeRestart);
  await evidence.assertClean();
});
