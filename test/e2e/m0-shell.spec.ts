import { readFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures/compose-stack";

const validFixture = JSON.parse(readFileSync(
  "test/definition/fixtures/valid-workflow.json",
  "utf8",
));

function definition(name: string) {
  return { ...validFixture, metadata: { name } };
}

async function importWorkflow(page: Page, value: unknown) {
  await page.getByRole("button", { name: "Import workflow" }).click();
  await page.getByLabel("Workflow JSON").fill(JSON.stringify(value, null, 2));
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && candidate.url().endsWith("/api/workflows/import"));
  await page.getByRole("button", { name: "Import", exact: true }).click();
  return response;
}

async function submitRun(page: Page, prompt: string, repeat = false, expectedPrefill?: string) {
  await page.getByRole("button", { name: repeat ? "Run again" : "Run workflow" }).click();
  const sheet = page.getByRole("dialog", { name: "Run workflow" });
  const promptInput = sheet.getByLabel("Prompt");
  if (!repeat) await expect(sheet.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  if (expectedPrefill !== undefined) await expect(promptInput).toHaveValue(expectedPrefill);
  await promptInput.fill(prompt);
  await expect(sheet.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && candidate.url().endsWith("/api/runs"));
  await sheet.getByRole("button", { name: "Run", exact: true }).click();
  const created = await response;
  expect(created.status()).toBe(202);
  const body = await created.json() as { runId: string; status: string };
  expect(Object.keys(body).sort()).toEqual(["runId", "status"]);
  expect(body).toEqual({ runId: expect.stringMatching(/^run-/u), status: "queued" });
  await expect(page).toHaveURL(new RegExp(`/runs/${body.runId}$`, "u"));
  return body.runId;
}

function facts(page: Page) {
  return page.getByRole("region", { name: "Run facts" });
}

function node(page: Page, type: string) {
  return page.getByRole("region", { name: "Board" }).getByRole("article").filter({ hasText: type });
}

async function expectRunStatus(page: Page, status: "Queued" | "Running" | "Succeeded" | "Failed") {
  await expect(facts(page).getByText(status, { exact: true })).toBeVisible();
}

async function expectFailure(page: Page, code: string, message: string) {
  await expectRunStatus(page, "Failed");
  await expect(node(page, "input.prompt").getByText("Succeeded", { exact: true })).toBeVisible();
  await expect(node(page, "process.agent").getByText("Failed", { exact: true })).toBeVisible();
  await expect(node(page, "output.markdown").getByText("Skipped", { exact: true })).toBeVisible();
  await expect(page.getByText(code, { exact: true })).toBeVisible();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByText("Affected node", { exact: true })).toBeVisible();
  await expect(page.getByText("analyze", { exact: true })).toBeVisible();
  await expect(page.getByText("Why downstream was skipped", { exact: true })).toBeVisible();
  await expect(page.getByText("M0 does not support Retry", { exact: true })).toBeVisible();
  await expect(page.getByText("Next step", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
}

async function saveScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({ path: testInfo.outputPath(name), fullPage: true });
}

test("A — imports, runs, reopens history, and runs again on the real stack", async ({
  page, stack, evidence,
}, testInfo) => {
  const workflowName = `PR6 Happy ${testInfo.workerIndex}-${Date.now()}`;
  const value = definition(workflowName);
  const correlation = `pr6-happy-${testInfo.workerIndex}-${Date.now()}`;
  await stack.configureProvider(correlation, "timeout");

  await page.goto(stack.appUrl);
  await expect(page.getByRole("heading", { name: "Workflows", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "M0 Bootstrap Workflow" })).toBeVisible();

  let imported = await importWorkflow(page, value);
  expect(imported.status()).toBe(201);
  await expect(page.getByRole("heading", { name: workflowName, level: 1 })).toBeVisible();
  await expect(page.getByText("Definition v1", { exact: true })).toBeVisible();

  await page.goto(stack.appUrl);
  imported = await importWorkflow(page, value);
  expect(imported.status()).toBe(201);
  await expect(page.getByText("Definition v2", { exact: true })).toBeVisible();

  const invalid = structuredClone(value);
  invalid.spec.nodes[1].config.providerBindingRef = "missing-binding";
  await page.goto(stack.appUrl);
  const rejected = await importWorkflow(page, invalid);
  expect(rejected.status()).toBe(400);
  expect(await rejected.json()).toMatchObject({
    code: "validation_error",
    path: "spec.nodes[1].config.providerBindingRef",
    nodeId: "analyze",
  });
  await expect(page.getByText("spec.nodes[1].config.providerBindingRef", { exact: true })).toBeVisible();
  await expect(page.getByText("analyze", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: workflowName }).click();
  await expect(page.getByText("Definition v2", { exact: true })).toBeVisible();

  const board = page.getByRole("region", { name: "Board" });
  await expect(board.getByText("input.prompt", { exact: true })).toBeVisible();
  await expect(board.getByText("process.agent", { exact: true })).toBeVisible();
  await expect(board.getByText("output.markdown", { exact: true })).toBeVisible();
  await expect(board.getByRole("textbox")).toHaveCount(0);

  const prompt = `Investigate ${correlation}`;
  const runId = await submitRun(page, prompt);
  await expectRunStatus(page, "Queued");
  await stack.startWorker({ providerTimeoutMs: 5_000 });
  await expectRunStatus(page, "Running");
  await expectRunStatus(page, "Succeeded");
  for (const type of ["input.prompt", "process.agent", "output.markdown"]) {
    await expect(node(page, type).getByText("Succeeded", { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Output" })).toContainText("Fake provider response");
  await expect(facts(page)).toContainText("Definition v2");

  await page.getByRole("link", { name: "History", exact: true }).click();
  const historyRow = page.getByRole("row").filter({ hasText: runId });
  await expect(historyRow).toContainText("Succeeded");
  await expect(historyRow).toContainText("Definition v2");
  await historyRow.getByRole("link", { name: runId }).click();
  await expectRunStatus(page, "Succeeded");

  const secondRunId = await submitRun(page, prompt, true, prompt);
  expect(secondRunId).not.toBe(runId);
  await expect(page.getByRole("dialog", { name: "Run workflow" })).toHaveCount(0);
  await expectRunStatus(page, "Succeeded");
  await evidence.assertClean();
  await saveScreenshot(page, testInfo, "happy-light-desktop.png");
});

test("B — explains auth, timeout, and empty-output failures without Retry", async ({
  page, stack, evidence,
}, testInfo) => {
  await stack.startWorker({ providerTimeoutMs: 200 });
  await page.goto(`${stack.appUrl}/workflows/seed-workflow`);
  const cases = [
    ["auth_failure", "provider_auth_failed", "Provider authentication failed"],
    ["timeout", "provider_timeout", "Provider request timed out"],
    ["empty_output", "provider_empty_output", "Provider returned empty output"],
  ] as const;

  for (const [index, [mode, code, message]] of cases.entries()) {
    const correlation = `pr6-${mode}-${Date.now()}`;
    await stack.configureProvider(correlation, mode);
    await submitRun(page, `Investigate ${correlation}`, index > 0);
    await expectFailure(page, code, message);
    expect(await stack.providerCalls(correlation)).toBe(1);
  }

  await evidence.assertClean();
  await page.emulateMedia({ colorScheme: "dark" });
  await saveScreenshot(page, testInfo, "failure-dark-desktop.png");
});

const secretSafeTest = test.extend({});
secretSafeTest.use({
  screenshot: "off",
  trace: "off",
  useSecretSentinel: true,
  video: "off",
});

secretSafeTest.describe("C — secret-safe crash and restart evidence", () => {
  secretSafeTest.describe.configure({ mode: "default" });

  secretSafeTest("C — projects worker loss and preserves browser history through a full restart", async ({
    page, stack, evidence,
  }) => {
    await page.goto(`${stack.appUrl}/workflows/seed-workflow`);
    const before = `pr6-crash-before-${Date.now()}`;
    await stack.configureProvider(before, "success");
    const beforeRunId = await submitRun(page, `Investigate ${before}`);
    await stack.startWorker({ faultHook: "before_model_request" });
    await stack.waitForWorkerExit();
    await stack.waitForExpiredLease(beforeRunId);
    await stack.sweepExpiredLeases();
    await expectFailure(page, "worker_lost", "Worker was lost before provider dispatch");
    expect(await stack.providerCalls(before)).toBe(0);

    await stack.stopWorker();
    const after = `pr6-crash-after-${Date.now()}`;
    await stack.configureProvider(after, "success");
    const afterRunId = await submitRun(page, `Investigate ${after}`, true);
    await stack.startWorker({ faultHook: "after_model_request_before_persist" });
    await stack.waitForWorkerExit();
    await stack.waitForExpiredLease(afterRunId);
    await stack.sweepExpiredLeases();
    await expectFailure(page, "outcome_unknown", "Provider outcome is unknown");
    expect(await stack.providerCalls(after)).toBe(1);
    const logs = await stack.logs();
    expect(logs.includes(stack.secret), "compose logs contained the test secret").toBe(false);

    await stack.stopWorker();
    await stack.startWorker();
    const successful = `pr6-restart-success-${Date.now()}`;
    await stack.configureProvider(successful, "success");
    const successfulRunId = await submitRun(page, `Investigate ${successful}`, true);
    await expectRunStatus(page, "Succeeded");
    await expect(page.getByRole("region", { name: "Output" })).toContainText("Fake provider response");

    await page.goto("about:blank");
    await stack.restartAll();
    await page.goto(stack.appUrl);
    await page.getByRole("link", { name: "M0 Bootstrap Workflow" }).click();
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.getByRole("link", { name: successfulRunId }).click();
    await expect(facts(page)).toContainText("Definition v1");
    for (const type of ["input.prompt", "process.agent", "output.markdown"]) {
      await expect(node(page, type).getByText("Succeeded", { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("region", { name: "Output" })).toContainText("Fake provider response");
    await page.getByRole("link", { name: "History", exact: true }).click();
    await page.getByRole("link", { name: afterRunId }).click();
    await expectFailure(page, "outcome_unknown", "Provider outcome is unknown");
    expect(await stack.providerCalls(after)).toBe(0);
    await evidence.assertClean();
  });
});

test("D — keeps per-agent model facts readable in light, dark, and narrow layouts", async ({
  page, stack, evidence,
}, testInfo) => {
  const configuredModel = "configured-model-current";
  const longWorkflowName = `PR6${"UnbrokenWorkflowName".repeat(12)}${Date.now()}`;
  await stack.startWorker();
  await stack.setAppConfiguredModel(configuredModel);
  await page.goto(stack.appUrl);
  const imported = await importWorkflow(page, definition(longWorkflowName));
  expect(imported.status()).toBe(201);

  const definitionAgent = node(page, "process.agent");
  await expect(
    definitionAgent.getByText("Provider binding", { exact: true }).locator(".."),
  ).toContainText("fake-default");
  await expect(
    definitionAgent.getByText("Configured model", { exact: true }).locator(".."),
  ).toContainText(configuredModel);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: longWorkflowName, level: 1 })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await submitRun(page, `Responsive check ${Date.now()}`);
  await expectRunStatus(page, "Succeeded");

  const agent = node(page, "process.agent");
  const configured = agent.getByText("Configured model", { exact: true }).locator("..");
  const effective = agent.getByText("Effective model", { exact: true }).locator("..");
  await expect(agent.getByText("Provider binding", { exact: true }).locator("..")).toContainText("fake-default");
  await expect(configured).toContainText(configuredModel);
  await expect(configured).not.toContainText("fake-m0");
  await expect(effective).toContainText("fake-m0");
  await expect(effective).not.toContainText(configuredModel);
  await expect(page.getByRole("heading", { name: "Provider", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Provider", exact: true })).toHaveCount(0);
  await expect(page.getByText("Succeeded with warnings", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Waiting", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cancelled", { exact: true })).toHaveCount(0);

  await evidence.assertClean();
  await page.emulateMedia({ colorScheme: "light" });
  await saveScreenshot(page, testInfo, "light-desktop.png");
  await page.emulateMedia({ colorScheme: "dark" });
  await saveScreenshot(page, testInfo, "dark-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await saveScreenshot(page, testInfo, "dark-narrow.png");
});
