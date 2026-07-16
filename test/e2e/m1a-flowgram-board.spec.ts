import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/compose-stack";

const visualNodes = [
  { id: "prompt", label: "Input prompt", type: "input.prompt" },
  { id: "analyze", label: "Agent analysis", type: "process.agent" },
  { id: "result", label: "Markdown output", type: "output.markdown" },
] as const;

const visualEdges = [
  ["prompt", "analyze"],
  ["analyze", "result"],
] as const;

function canvas(page: Page) {
  return page.getByRole("region", { name: "Workflow canvas" });
}

function renderer(page: Page) {
  return canvas(page).locator(".flowgram-editor");
}

function canvasNode(page: Page, node: typeof visualNodes[number]) {
  return renderer(page).getByRole("button", { name: `${node.label} (${node.id})`, exact: true });
}

function rendererNode(page: Page, node: typeof visualNodes[number]) {
  return canvasNode(page, node).locator("xpath=../..");
}

function nodeDetail(page: Page) {
  return page.getByRole("region", { name: "Node detail" });
}

function captureOnlyForcedCanvasFailure(page: Page) {
  const forcedCanvasFailure = "Forced canvas failure";
  const browserErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    browserErrors.push(`pageerror: ${error.message}`);
  });

  return () => {
    const unexpectedErrors = browserErrors.filter(
      (error) => !error.includes(forcedCanvasFailure),
    );
    expect(unexpectedErrors, "unexpected browser errors").toEqual([]);
  };
}

test("M1-A — projects a real workflow into a read-only FlowGram canvas with its Run overlay", async ({
  page, stack, evidence,
}) => {
  const workflowPath = "/workflows/seed-workflow";
  const prompt = `M1-A FlowGram ${Date.now()}`;

  await page.goto(`${stack.appUrl}${workflowPath}`);
  await expect(page.getByRole("heading", { name: "M0 Bootstrap Workflow", level: 1 })).toBeVisible();

  await expect(canvas(page)).toBeVisible();
  await expect(canvas(page).locator(".canvas-fallback")).toHaveCount(0);
  await expect(renderer(page)).toBeVisible();
  await expect(renderer(page).locator(".gedit-playground")).toBeVisible();
  await expect(renderer(page).locator(".flowgram-rendered-node")).toHaveCount(visualNodes.length);
  const flowgramEdges = renderer(page).locator(".gedit-flow-activity-edge");
  await expect(flowgramEdges).toHaveCount(visualEdges.length);
  for (let index = 0; index < visualEdges.length; index += 1) {
    await expect(flowgramEdges.nth(index)).toBeVisible();
  }
  for (const node of visualNodes) {
    const visualNode = canvasNode(page, node);
    await expect(visualNode).toBeVisible();
    await expect(visualNode).toHaveAttribute("data-product-node-id", node.id);
    await expect(rendererNode(page, node)).toBeVisible();
  }
  for (const [source, target] of visualEdges) {
    await expect(
      canvas(page).getByRole("img", { name: `Connection from ${source} to ${target}`, exact: true }),
    ).toHaveCount(1);
  }

  await canvasNode(page, visualNodes[1]).click();
  await expect(rendererNode(page, visualNodes[1])).toHaveAttribute("data-node-selected", "true");
  await expect(nodeDetail(page)).toContainText("analyze");
  await expect(nodeDetail(page)).toContainText("process.agent");

  await page.getByRole("button", { name: "Run workflow" }).click();
  const dialog = page.getByRole("dialog", { name: "Run workflow" });
  await dialog.getByLabel("Prompt").fill(prompt);
  const createdResponse = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && candidate.url().endsWith("/api/runs"));
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(202);
  expect(await created.json()).toMatchObject({
    runId: expect.stringMatching(/^run-/u),
    status: "queued",
  });
  await expect(page).toHaveURL(new RegExp(`${workflowPath}$`, "u"));

  await stack.startWorker();
  for (const node of visualNodes) {
    await expect(canvasNode(page, node).getByText("Succeeded", { exact: true })).toBeVisible();
  }

  await canvasNode(page, visualNodes[0]).click();
  await expect(nodeDetail(page)).toContainText("prompt");
  await expect(nodeDetail(page)).toContainText("input.prompt");
  await expect(nodeDetail(page)).toContainText(prompt);

  await canvasNode(page, visualNodes[2]).click();
  await expect(nodeDetail(page)).toContainText("result");
  await expect(nodeDetail(page)).toContainText("output.markdown");
  await expect(nodeDetail(page)).toContainText("Fake provider response");
  await expect(page.getByRole("region", { name: "Output" })).toContainText("Fake provider response");
  await evidence.assertClean();
});

test("M1-A — isolates a forced FlowGram canvas failure from Run execution", async ({
  page,
  stack,
}) => {
  const workflowPath = "/workflows/seed-workflow";
  const prompt = "Explain the canvas failure boundary.";
  const assertOnlyForcedCanvasFailure = captureOnlyForcedCanvasFailure(page);

  await page.addInitScript(
    "globalThis.__WORKFLOW_E2E_FORCE_CANVAS_FAILURE__ = true;",
  );
  await page.goto(`${stack.appUrl}${workflowPath}`);
  const workflowUrl = page.url();

  await expect(page.getByRole("heading", { name: "M0 Bootstrap Workflow", level: 1 })).toBeVisible();
  const fallback = canvas(page).getByRole("status");
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("Canvas fallback");
  const fallbackItems = fallback.getByRole("listitem");
  await expect(fallbackItems).toHaveCount(visualNodes.length);
  for (const [index, node] of visualNodes.entries()) {
    await expect(fallbackItems.nth(index)).toContainText(node.label);
    await expect(fallbackItems.nth(index)).toContainText(node.type);
  }
  await expect(renderer(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Run workflow" }).click();
  const dialog = page.getByRole("dialog", { name: "Run workflow" });
  await dialog.getByLabel("Prompt").fill(prompt);
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/runs") &&
      response.request().method() === "POST" &&
      response.status() === 202,
  );
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  const createdRun = (await (await createdResponse).json()) as {
    runId: string;
    status: string;
  };

  expect(createdRun).toEqual({
    runId: expect.stringMatching(/^run-/u),
    status: "queued",
  });
  await expect(page).toHaveURL(workflowUrl);

  await stack.startWorker();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`${stack.appUrl}/api/runs/${createdRun.runId}`);
        expect(response.ok()).toBe(true);
        const body = (await response.json()) as {
          run: { nodes: Array<{ status: string }>; status: string };
        };
        return [body.run.status, ...body.run.nodes.map((node) => node.status)];
      },
      { timeout: 15_000 },
    )
    .toEqual(["succeeded", "succeeded", "succeeded", "succeeded"]);

  await expect(page.getByRole("region", { name: "Output" })).toContainText(
    "Fake provider response",
  );
  assertOnlyForcedCanvasFailure();
});
