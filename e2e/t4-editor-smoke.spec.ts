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

  const canvas = page.locator('.gedit-playground');
  await expect(canvas).toBeVisible();
  await canvas.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Meta+a');
  for (const action of ['Collapse', 'Expand', 'Create group', 'Copy', 'Delete']) {
    const selectorAction = page.getByRole('button', { name: action, exact: true });
    await expect(selectorAction).toBeVisible();
    await selectorAction.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(action);
  }
  await canvas.click({ position: { x: 500, y: 500 } });

  const nodeActions = page.locator('[data-node-id="llm_main"] button[aria-label="Node actions"]');
  await nodeActions.hover();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.move(300, 300);
  await expect(page.getByRole('menu')).toBeHidden();
  await nodeActions.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();

  const zoomButton = page.getByRole('button', { name: 'Zoom level' });
  await zoomButton.click();
  await expect(page.getByRole('dialog', { name: 'Zoom options' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Zoom options' })).toBeHidden();
  await zoomButton.click();
  await page.mouse.click(300, 300);
  await expect(page.getByRole('dialog', { name: 'Zoom options' })).toBeHidden();

  const interactionButton = page.getByRole('button', { name: 'Interaction mode' });
  await interactionButton.click();
  await expect(page.getByText('Mouse-Friendly', { exact: true })).toBeVisible();
  await expect(page.getByText('Touchpad-Friendly', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Mouse-Friendly', { exact: true })).toBeHidden();

  // The editable node panel keeps the variable affordance that the canvas
  // preview intentionally omits: typing `{{` opens the available variables,
  // and choosing one writes the complete template reference.
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });
  const prompt = page.locator('textarea[aria-label="Template value"]:not([readonly])');
  const saveButton = page.getByRole('button', { name: 'Save', exact: true });
  await expect(prompt).toBeVisible();
  await prompt.fill('{{');
  const variableSuggestions = page.getByRole('tree', { name: 'Available variables' });
  await expect(variableSuggestions).toBeVisible();
  await expect(prompt).toBeFocused();
  await page.keyboard.type('continued');
  await expect(prompt).toHaveValue('{{continued');
  await expect(prompt).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(variableSuggestions).toBeHidden();
  await expect(prompt).toBeFocused();

  await prompt.fill('{{');
  await expect(variableSuggestions).toBeVisible();
  const variableTreeItems = variableSuggestions.locator('[data-variable-tree-focus]:visible');
  await expect(variableTreeItems.first()).toBeVisible();
  await variableTreeItems.first().focus();
  await expect(variableTreeItems.first()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(variableTreeItems.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(variableTreeItems.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(variableTreeItems.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(variableTreeItems.last()).toBeFocused();

  const variableBranch = variableSuggestions.locator('[data-variable-tree-item="start_0"]');
  await expect(variableBranch).toBeVisible();
  const variableBranchButton = variableBranch.locator('[data-variable-tree-focus]').first();
  await variableBranchButton.focus();
  await variableBranchButton.press('ArrowLeft');
  await expect(variableBranch).toHaveAttribute('aria-expanded', 'false');
  await variableBranchButton.press('ArrowRight');
  await expect(variableBranch).toHaveAttribute('aria-expanded', 'true');

  const variableLeaf = variableSuggestions
    .locator('[data-variable-tree-focus][data-variable-tree-leaf]:visible')
    .first();
  await variableLeaf.focus();
  await page.keyboard.press('Enter');
  await expect(variableSuggestions).toBeHidden();
  await expect(prompt).toHaveValue(/^\{\{.+\}\}$/);
  await expect(prompt).toBeFocused();

  await prompt.fill('{{');
  await expect(variableSuggestions).toBeVisible();
  await variableSuggestions.getByRole('button', { name: /query/ }).click();
  await expect(prompt).toHaveValue('{{start_0.query}}');
  await prompt.fill('');
  await prompt.fill('{{');
  await expect(variableSuggestions).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(variableSuggestions).toBeHidden();
  await prompt.fill('');
  await prompt.fill('{{');
  await expect(variableSuggestions).toBeVisible();
  await page.mouse.click(800, 800);
  await expect(variableSuggestions).toBeHidden();
  await expect(saveButton).toBeEnabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });

  const addField = page.getByRole('button', { name: 'Add field', exact: true });
  const fieldNameInputs = page.locator('input[placeholder="field_name"]');
  await expect(addField).toBeVisible();
  await addField.focus();
  await expect(addField).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(fieldNameInputs).toHaveCount(2);
  await addField.focus();
  await page.keyboard.press(' ');
  await expect(fieldNameInputs).toHaveCount(3);

  // Add an unconnected node and create a real port-to-port connection. The
  // seeded edges above only prove serialization; this drag exercises the
  // editor's connection gesture and edge creation path.
  const addNodeButton = page.getByRole('button', { name: 'Add Node', exact: true });
  await addNodeButton.click();
  const nodeLibrary = page.getByRole('dialog', { name: 'Add node' });
  await expect(nodeLibrary).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(nodeLibrary).toBeHidden();
  await addNodeButton.click();
  await expect(nodeLibrary).toBeVisible();
  await canvas.click({ position: { x: 500, y: 500 } });
  await expect(nodeLibrary).toBeHidden();
  await addNodeButton.click();
  await expect(nodeLibrary).toBeVisible();
  await page.getByTestId('demo-free-node-list-condition').click();
  const addedCondition = page.locator('[data-node-id^="condition_"]').last();
  await expect(addedCondition).toBeVisible();
  await page.locator('.gedit-flow-activity-edge').first().hover();
  const lineAddButton = page
    .locator('[data-testid="sdk.workflow.canvas.line.add"]:visible')
    .first();
  await expect(lineAddButton).toBeVisible();
  await lineAddButton.click();
  const lineNodePanel = page.getByText('Add node', { exact: true });
  await expect(lineNodePanel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lineNodePanel).toBeHidden();
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

  await page
    .locator('[data-node-id="end_0"] [draggable="true"]')
    .click({ position: { x: 50, y: 15 }, force: true });
  await expect(page.getByRole('button', { name: 'Close node settings' })).toBeVisible();
  const endVariablePicker = page.getByRole('button', { name: 'Select variable' });
  await expect(endVariablePicker).toBeVisible();
  await endVariablePicker.click();
  const endVariables = page.getByRole('tree', { name: 'Available variables' });
  await expect(endVariables).toBeVisible();
  await page.getByText('End', { exact: true }).last().click();
  await expect(endVariables).toBeHidden();
  await endVariablePicker.click();
  await expect(endVariables).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(endVariables).toBeHidden();
  await endVariablePicker.click();
  await expect(endVariables).toBeVisible();
  await endVariables.getByRole('button', { name: /result/ }).click();
  await expect(endVariablePicker).toContainText('llm_main.result');
  await page.getByRole('button', { name: 'Close node settings' }).click();

  const variablePanelToggle = page.getByRole('button', { name: 'Toggle Variable Panel' });
  await variablePanelToggle.click();
  const fullVariableTree = page
    .locator('[role="tree"][aria-label="Available variables"]:visible')
    .last();
  await expect(fullVariableTree).toBeVisible();
  await fullVariableTree.focus();
  await expect(fullVariableTree).toBeFocused();
  const fullVariableItems = fullVariableTree.locator('[data-variable-tree-focus]:visible');
  await expect(fullVariableItems.first()).toBeVisible();
  await page.keyboard.press('Home');
  await expect(fullVariableItems.first()).toBeFocused();
  await page.keyboard.press('End');
  await expect(fullVariableItems.last()).toBeFocused();
  const fullVariableBranch = fullVariableTree.locator('[data-variable-tree-item="llm_main"]');
  await expect(fullVariableBranch).toBeVisible();
  await fullVariableBranch.locator('[data-variable-tree-focus]').first().focus();
  await page.keyboard.press('ArrowLeft');
  await expect(fullVariableBranch).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(fullVariableBranch).toHaveAttribute('aria-expanded', 'true');
  await variablePanelToggle.click();

  await page.setViewportSize({ width: 720, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('t4-editor-720x900-narrow.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  const tools = page.locator('.workflow-tools');
  await tools.getByRole('button', { name: 'Test Run', exact: true }).click();
  await expect(page.getByText('Input Form', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Input Form', { exact: true })).toBeHidden();
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
  await expect(page.getByText('Unsaved changes', { exact: true })).toHaveCount(0);
  await expect(saveButton).toBeEnabled();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
});
