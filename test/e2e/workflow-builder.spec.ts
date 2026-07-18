import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures/compose-stack";

async function expectInViewport(locator: Locator, viewportHeight: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewportHeight);
}

test("authors, connects, runs, and inspects a workflow through the Builder UI", async ({ page, stack, evidence }) => {
  const viewports = [{ width: 1440, height: 900 }, { width: 1280, height: 720 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(stack.appUrl);

    await page.getByRole("button", { name: "New workflow" }).click();
    await expect(page.getByLabel("Workflow name")).toBeVisible();
    await page.getByLabel("Workflow name").fill(`Builder E2E ${viewport.width}`);

  // The editor is an application workspace, not a document that requires page
  // scrolling to reach its primary controls.
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
    await expectInViewport(page.getByRole("button", { name: "Delete workflow" }), viewport.height);
    await expectInViewport(page.getByRole("region", { name: "Workflow builder" }), viewport.height);
    await expectInViewport(page.getByRole("button", { name: "+ Add node" }), viewport.height);

    await page.getByRole("button", { name: "+ Add node" }).click();
    const picker = page.getByRole("dialog", { name: "Add node" });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: "Prompt" })).toBeDisabled();
    await expect(picker.getByText("An Input node already exists for this workflow.")).toBeVisible();
    await expect(picker.getByRole("button", { name: "Markdown" })).toBeDisabled();
    await expect(picker.getByText("Add a Condition branch first")).toBeVisible();

    await picker.getByRole("button", { name: "Agent" }).click();
    const inspector = page.getByRole("complementary", { name: "Inspector" });
    await expect(inspector.getByRole("heading", { name: "Agent" })).toBeVisible();
    await inspector.getByLabel("System prompt").fill("Return a concise Builder E2E result.");
    await inspector.getByLabel("Provider").selectOption("fake-default");
    await expect(page.getByRole("status")).toContainText("Agent connected");

    await page.getByRole("button", { name: "+ Add node" }).click();
    await page.getByRole("dialog", { name: "Add node" }).getByRole("button", { name: "Condition" }).click();
    await expect(inspector.getByRole("heading", { name: "Condition" })).toBeVisible();
    await inspector.getByLabel("Right value").selectOption("literal");
    await expect(page.getByRole("status")).toContainText("Condition connected");

    await page.getByRole("button", { name: "+ Add node" }).click();
    const connectionPicker = page.getByRole("dialog", { name: "Add node" });
    await connectionPicker.getByRole("button", { name: "Agent" }).click();
    await expect(connectionPicker.getByRole("heading", { name: "Choose connection" })).toBeVisible();
    await expect(connectionPicker.getByRole("button", { name: /Insert Agent on/u }).first()).toBeVisible();
    await connectionPicker.getByRole("button", { name: "Close Add node" }).click();

    await inspector.getByRole("button", { name: "+ Add else if" }).click();
    await page.getByRole("button", { name: "+ Add node" }).click();
    await expect(page.getByRole("dialog", { name: "Add node" }).getByRole("button", { name: "Markdown" })).toBeEnabled();
    await page.getByRole("dialog", { name: "Add node" }).getByRole("button", { name: "Markdown" }).click();
    await expect(inspector.getByRole("heading", { name: "Output" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Markdown connected");
    await expect(page.getByRole("button", { name: /^Output node /u })).toHaveCount(2);

    const saved = page.waitForResponse((response) => response.request().method() === "PUT" && /\/api\/workflows\/[^/]+$/u.test(response.url()));
    await page.getByRole("button", { name: "Save" }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.locator(".validation-error")).toHaveCount(0);

    await stack.startWorker();
    await page.getByRole("button", { name: "▶ Test run" }).click();
    const runDialog = page.getByRole("dialog", { name: "Run workflow" });
    await runDialog.getByLabel("Prompt").fill("builder-ui-e2e");
    const started = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/runs"));
    await runDialog.getByRole("button", { name: "Run", exact: true }).click();
    expect((await started).status()).toBe(202);

    const actions = page.locator(".builder-top-actions");
    const history = actions.getByRole("button", { name: "Workflow history" });
    const deleteWorkflow = actions.getByRole("button", { name: "Delete workflow" });
    await expect(history).toBeVisible();
    await expect(deleteWorkflow).toBeVisible();
    expect(await history.evaluate((element) => element.nextElementSibling?.textContent?.trim())).toBe("Delete workflow");

    await history.click();
    const historyDialog = page.getByRole("dialog", { name: "Workflow history" });
    await expect(historyDialog).toBeVisible();
    const run = historyDialog.getByRole("button", { name: "View run details" });
    await expect(run).toBeVisible();
    await run.click();
    await expect(historyDialog.getByRole("heading", { name: "Node run details" })).toBeVisible();
    await expect(historyDialog.getByText("Input", { exact: true })).toBeVisible();
    await expect(historyDialog.getByText("Agent", { exact: true })).toBeVisible();
    await expect(historyDialog.getByText("Condition", { exact: true })).toBeVisible();
    await historyDialog.getByRole("button", { name: "Close Workflow history" }).click();
  }

  await evidence.assertClean();
});
