import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/compose-stack";

const validDefinition = JSON.parse(readFileSync(
  "test/definition/fixtures/valid-workflow.json",
  "utf8",
));

const successfulTimeline = [
  [1, "workflow.run.queued", null],
  [2, "workflow.run.started", null],
  [3, "node.attempt.started", "prompt"],
  [4, "node.attempt.succeeded", "prompt"],
  [5, "node.attempt.started", "analyze"],
  [6, "agent.execution.started", "analyze"],
  [7, "agent.execution.succeeded", "analyze"],
  [8, "node.attempt.succeeded", "analyze"],
  [9, "node.attempt.started", "result"],
  [10, "node.attempt.succeeded", "result"],
  [11, "artifact.created", "result"],
  [12, "workflow.run.succeeded", null],
] as const;

async function createQueuedRun(page: Page, prompt: string) {
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

async function importWorkflow(page: Page, definition: unknown) {
  await page.getByRole("button", { name: "Import workflow" }).click();
  await page.getByLabel("Workflow JSON").fill(JSON.stringify(definition, null, 2));
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && candidate.url().endsWith("/api/workflows/import"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  return response;
}

async function waitForSucceededRun(page: Page, appUrl: string, runId: string) {
  await expect.poll(async () => {
    const response = await page.request.get(`${appUrl}/api/runs/${runId}`);
    if (!response.ok()) return response.status();
    const body = await response.json() as { run: { status: string } };
    return body.run.status;
  }).toBe("succeeded");
}

async function expectSuccessfulTimeline(
  page: Page,
  prompt: string,
  secret: string,
) {
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toBeVisible();
  const events = timeline.getByRole("listitem");
  await expect(events).toHaveCount(successfulTimeline.length);

  for (const [index, [sequence, type, nodeId]] of successfulTimeline.entries()) {
    const event = events.nth(index);
    await expect(event).toContainText(String(sequence));
    await expect(event).toContainText(type);
    if (nodeId) await expect(event).toContainText(nodeId);
  }

  const output = "Fake provider response";
  const artifact = events.nth(10);
  await expect(artifact).toContainText("node.output");
  await expect(artifact).toContainText("result");
  await expect(artifact).toContainText(
    createHash("sha256").update(output, "utf8").digest("hex"),
  );
  await expect(artifact).toContainText("text/markdown");
  await expect(artifact).toContainText(`${Buffer.byteLength(output, "utf8")}`);
  await expect(artifact).toContainText("internal");
  await expect(artifact).toContainText("run-history");

  await expect(timeline).not.toContainText(prompt);
  await expect(timeline).not.toContainText(output);
  await expect(timeline).not.toContainText(secret);
  await expect(timeline).not.toContainText("payload");
  await expect(page.locator("body")).not.toContainText(secret);
}

function captureOnlyInjectedPollingFailure(page: Page, detailUrl: string) {
  const browserErrors: Array<{ kind: string; text: string; url: string }> = [];
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    browserErrors.push({
      kind: `console.${message.type()}`,
      text: message.text(),
      url: message.location().url,
    });
  });
  page.on("pageerror", (error) => {
    browserErrors.push({ kind: "pageerror", text: error.message, url: "" });
  });

  return () => {
    const injected = browserErrors.filter((error) =>
      error.kind === "console.error" &&
      error.text === "Failed to load resource: net::ERR_FAILED" &&
      error.url === detailUrl);
    expect(injected, "the injected polling failure was not observed exactly once").toHaveLength(1);
    expect(
      browserErrors.filter((error) => !injected.includes(error)),
      "browser emitted an error other than the injected polling failure",
    ).toEqual([]);
  };
}

test("M1-C — a queued Run completes away from the page and reopens with a safe Timeline", async ({
  page,
  stack,
  evidence,
}) => {
  const correlation = `m1c-detached-${Date.now()}`;
  const prompt = `M1-C detached Run ${correlation}`;
  await stack.configureProvider(correlation, "success");
  await page.goto(`${stack.appUrl}/workflows/seed-workflow`);
  const runId = await createQueuedRun(page, prompt);

  await page.goto("about:blank");
  await stack.startWorker();
  await waitForSucceededRun(page, stack.appUrl, runId);

  await page.goto(`${stack.appUrl}/workflows/seed-workflow`);
  await page.getByRole("link", { name: "History", exact: true }).click();
  const historyRow = page.getByRole("row").filter({ hasText: runId });
  await expect(historyRow).toContainText("Succeeded");
  await historyRow.getByRole("link", { name: runId }).click();

  await expect(page.getByRole("region", { name: "Run facts" })).toContainText("Succeeded");
  await expect(page.getByRole("region", { name: "Output" })).toContainText(
    "Fake provider response",
  );
  await expectSuccessfulTimeline(page, prompt, stack.secret);
  expect(await stack.providerCalls(correlation)).toBe(1);
  await evidence.assertClean();
});

test("M1-C — Run Detail polling recovers after one transient request failure", async ({
  page,
  stack,
}) => {
  const correlation = `m1c-poll-recovery-${Date.now()}`;
  const prompt = `M1-C polling recovery ${correlation}`;
  await stack.configureProvider(correlation, "success");
  await page.goto(`${stack.appUrl}/workflows/seed-workflow`);
  const runId = await createQueuedRun(page, prompt);
  const detailUrl = `${stack.appUrl}/api/runs/${runId}`;
  let pollRequests = 0;
  let injectedFailures = 0;
  const assertOnlyInjectedPollingFailure = captureOnlyInjectedPollingFailure(page, detailUrl);

  await page.route(detailUrl, async (route) => {
    pollRequests += 1;
    if (pollRequests === 1) {
      injectedFailures += 1;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto(`${stack.appUrl}/runs/${runId}`);
  const loadError = page.getByText("Run could not be loaded", { exact: true });
  await expect(loadError).toBeVisible();
  await stack.startWorker();

  await expect.poll(() => pollRequests).toBeGreaterThan(1);
  await expect(loadError).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Run facts" })).toContainText("Succeeded");
  await expect(page.getByRole("region", { name: "Output" })).toContainText(
    "Fake provider response",
  );
  await expectSuccessfulTimeline(page, prompt, stack.secret);
  expect(await stack.providerCalls(correlation)).toBe(1);
  expect(injectedFailures).toBe(1);
  assertOnlyInjectedPollingFailure();
});

test("M1-C — artifact metadata follows a non-default Output node ID", async ({
  page,
  stack,
  evidence,
}) => {
  const outputNodeId = "result-v1";
  const correlation = `m1c-custom-output-${Date.now()}`;
  const prompt = `M1-C custom Output ${correlation}`;
  const definition = structuredClone(validDefinition);
  definition.metadata.name = `M1-C custom Output ${Date.now()}`;
  definition.spec.nodes = definition.spec.nodes.map((node: { id: string }) => ({
    ...node,
    id: node.id === "result" ? outputNodeId : node.id,
  }));
  definition.spec.edges = definition.spec.edges.map((edge: { from: string; to: string }) => ({
    ...edge,
    from: edge.from === "result" ? outputNodeId : edge.from,
    to: edge.to === "result" ? outputNodeId : edge.to,
  }));

  await stack.configureProvider(correlation, "success");
  await page.goto(stack.appUrl);
  const imported = await importWorkflow(page, definition);
  expect(imported.status()).toBe(201);
  const runId = await createQueuedRun(page, prompt);
  await stack.startWorker();
  await waitForSucceededRun(page, stack.appUrl, runId);
  await page.goto(`${stack.appUrl}/runs/${runId}`);

  await expect(page.getByRole("region", { name: "Run facts" })).toContainText("Succeeded");
  await expect(page.getByRole("region", { name: "Output" })).toContainText(
    "Fake provider response",
  );
  const timeline = page.getByRole("region", { name: "Timeline" });
  const artifact = timeline.getByRole("listitem").filter({ hasText: "artifact.created" });
  await expect(artifact).toHaveCount(1);
  await expect(artifact.getByText(outputNodeId, { exact: true })).toBeVisible();
  await expect(
    artifact.getByText(`node.output: ${outputNodeId}`, { exact: true }),
  ).toBeVisible();
  const output = "Fake provider response";
  await expect(artifact).toContainText(
    createHash("sha256").update(output, "utf8").digest("hex"),
  );
  await expect(artifact).toContainText("text/markdown");
  await expect(artifact).toContainText(`${Buffer.byteLength(output, "utf8")} bytes`);
  await expect(artifact).toContainText("internal");
  await expect(artifact).toContainText("run-history");
  await expect(artifact).not.toContainText(prompt);
  await expect(artifact).not.toContainText(output);
  await expect(artifact).not.toContainText(stack.secret);
  expect(await stack.providerCalls(correlation)).toBe(1);
  await evidence.assertClean();
});
