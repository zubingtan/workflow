import { test, expect } from '@playwright/test';

test('T4 creates, edits, saves, reloads and validates an editor workflow', async ({
  page,
}, testInfo) => {
  const workflowName = `E2E T4 Editor Smoke ${Date.now()}`;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/workflows');
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();

  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByPlaceholder('Workflow name').fill(workflowName);
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(page.getByText(workflowName, { exact: true })).toBeVisible();
  await expect(page.locator('[data-node-id="start_0"]')).toBeVisible();
  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await expect(page.locator('[data-node-id="end_0"]')).toBeVisible();
  await expect(page.locator('.gedit-flow-activity-edge')).toHaveCount(2);
  await page.screenshot({
    path: testInfo.outputPath('t4-editor-1440x900-light.png'),
    fullPage: true,
  });

  const saveButton = page.getByRole('button', { name: 'Save', exact: true });
  await page.getByRole('button', { name: 'Layout Direction: Horizontal' }).click();
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await saveButton.click();
  await expect(page.getByText('Workflow saved', { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.locator('[data-node-id="start_0"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await expect(page.locator('[data-node-id="end_0"]')).toBeVisible();
  await expect(page.locator('.gedit-flow-activity-edge')).toHaveCount(2);

  await page.setViewportSize({ width: 720, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('t4-editor-720x900-narrow.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  const tools = page.locator('.workflow-tools');
  await tools.getByRole('button', { name: 'Test Run', exact: true }).click();
  await expect(page.getByText('Input Form', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Test Run', exact: true }).last().click();
  await expect(page.getByText('llm_main: agentId is required', { exact: true })).toBeVisible({
    timeout: 10_000,
  });

  await page.getByRole('button', { name: 'Layout Direction: Vertical' }).click();
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
});
