import { test, expect } from '@playwright/test';

test('T4 creates, edits, saves, reloads and validates an editor workflow', async ({
  page,
}, testInfo) => {
  const workflowName = `E2E T4 Editor Smoke ${Date.now()}`;

  await page.addInitScript(() => localStorage.setItem('workflow-theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
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

  // Add an unconnected node and create a real port-to-port connection. The
  // seeded edges above only prove serialization; this drag exercises the
  // editor's connection gesture and edge creation path.
  await page.getByRole('button', { name: 'Add Node', exact: true }).click();
  await page.getByTestId('demo-free-node-list-condition').click();
  const addedCondition = page.locator('[data-node-id^="condition_"]').last();
  await expect(addedCondition).toBeVisible();
  const conditionOutput = addedCondition.locator('[data-port-id][data-port-type="output"]').last();
  const endNode = page.locator('[data-node-id="end_0"]');
  const endInput = endNode.locator('[data-port-entity-type="input"]').first();
  const [sourceCenter, targetCenter] = await Promise.all([
    conditionOutput.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }),
    endInput.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }),
  ]);
  expect(sourceCenter.x).toBeGreaterThan(0);
  expect(targetCenter.x).toBeGreaterThan(0);
  await page.mouse.move(sourceCenter.x, sourceCenter.y);
  await page.mouse.down();
  await page.mouse.move(targetCenter.x, targetCenter.y, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.gedit-flow-activity-edge')).toHaveCount(3);
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
  await expect(page.locator('.gedit-flow-activity-edge')).toHaveCount(3);
  await expect(page.locator('[data-node-id^="condition_"]').last()).toBeVisible();

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
