import { test, expect } from '@playwright/test';

test('T4 add node library opens centered above its trigger', async ({ page }) => {
  const workflowName = `E2E T4 Add Node ${Date.now()}`;

  await page.addInitScript(() => localStorage.setItem('workflow-theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/workflows');
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByPlaceholder('Workflow name').fill(workflowName);
  await page.getByRole('button', { name: 'OK' }).click();

  const addNodeButton = page.getByRole('button', { name: 'Add Node', exact: true });
  await expect(addNodeButton).toBeVisible();
  await addNodeButton.click();

  const nodeLibrary = page.getByRole('dialog', { name: 'Add node' });
  await expect(nodeLibrary).toBeVisible();
  const addNodeBox = await addNodeButton.boundingBox();
  const nodeLibraryBox = await nodeLibrary.boundingBox();
  expect(addNodeBox).not.toBeNull();
  expect(nodeLibraryBox).not.toBeNull();
  expect(nodeLibraryBox!.y + nodeLibraryBox!.height).toBeLessThanOrEqual(addNodeBox!.y);
  expect(
    Math.abs(
      nodeLibraryBox!.x + nodeLibraryBox!.width / 2 - (addNodeBox!.x + addNodeBox!.width / 2)
    )
  ).toBeLessThanOrEqual(1);

  await page.getByTestId('demo-free-node-list-condition').click();
  await expect(page.locator('[data-node-id^="condition_"]')).toHaveCount(1);
});

test('T4 agent selector chooses and persists the fake provider', async ({ page }) => {
  const workflowName = `E2E T4 Agent Select ${Date.now()}`;

  await page.addInitScript(() => localStorage.setItem('workflow-theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/workflows');
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByPlaceholder('Workflow name').fill(workflowName);
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });
  const agentSelect = page.locator('button[role="combobox"][aria-label="Agent"]:not(:disabled)');
  await expect(agentSelect).toBeVisible();
  await agentSelect.click();
  await page.getByRole('option', { name: /Fake Provider \(fake-m0\)/ }).click();
  await expect(agentSelect).toContainText('Fake Provider (fake-m0)');

  const saveButton = page.getByRole('button', { name: 'Save', exact: true });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText('Workflow saved', { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await page.reload();
  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });
  await expect(
    page.locator('button[role="combobox"][aria-label="Agent"]:not(:disabled)')
  ).toContainText('Fake Provider (fake-m0)');
});

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
  const nodeMenu = page.getByRole('menu');
  await expect(nodeMenu).toBeVisible();
  await nodeMenu.getByRole('menuitem', { name: 'Edit title' }).click();
  await expect(page.getByRole('textbox', { name: 'Node title' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Node title' }).press('Tab');
  await page.keyboard.press('Escape');
  await expect(nodeMenu).toBeHidden();

  const zoomButton = page.getByRole('button', { name: 'Zoom level' });
  await zoomButton.click();
  const zoomOptions = page.getByRole('dialog', { name: 'Zoom options' });
  await expect(zoomOptions).toBeVisible();
  await zoomOptions.getByRole('button', { name: 'Zoom to 50%' }).click();
  await expect(zoomButton).toHaveText('50%');
  await zoomButton.click();
  await zoomOptions.getByRole('button', { name: 'Zoom to 100%' }).click();
  await expect(zoomButton).toHaveText('100%');
  await zoomButton.click();
  await page.keyboard.press('Escape');
  await expect(zoomOptions).toBeHidden();
  await zoomButton.click();
  await page.mouse.click(300, 300);
  await expect(zoomOptions).toBeHidden();

  const interactionButton = page.getByRole('button', { name: 'Interaction mode' });
  await interactionButton.click();
  const interactionOptions = page.getByRole('group', { name: 'Interaction mode options' });
  const mouseMode = interactionOptions.getByRole('button', { name: /Mouse-Friendly/ });
  const touchpadMode = interactionOptions.getByRole('button', { name: /Touchpad-Friendly/ });
  await expect(mouseMode).toBeVisible();
  await expect(touchpadMode).toBeVisible();
  await touchpadMode.click();
  await expect(touchpadMode).toHaveAttribute('aria-pressed', 'true');
  await expect(mouseMode).toHaveAttribute('aria-pressed', 'false');
  await mouseMode.click();
  await expect(mouseMode).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(interactionOptions).toBeHidden();

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
  for (const key of ['global', 'global.userId', 'start_0', 'start_0.query']) {
    await expect(variableSuggestions.locator(`[data-variable-tree-item="${key}"]`)).toBeVisible({
      timeout: 5_000,
    });
  }
  await expect(prompt).toBeFocused();
  await page.keyboard.type('continued');
  await expect(prompt).toHaveValue('{{continued');
  await expect(prompt).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(variableSuggestions).toBeHidden();
  await expect(prompt).toBeFocused();

  await prompt.fill('{{');
  await prompt.press('End');
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
  await prompt.press('End');
  await expect(variableSuggestions).toBeVisible();
  await variableSuggestions.locator('[data-variable-tree-focus="global.userId"]').click();
  await expect(prompt).toHaveValue('{{global.userId}}');
  await prompt.fill('');
  await prompt.fill('{{');
  await prompt.press('End');
  await expect(variableSuggestions).toBeVisible();
  await variableSuggestions.getByRole('button', { name: /query/ }).click();
  await expect(prompt).toHaveValue('{{start_0.query}}');
  await prompt.fill('');
  await prompt.fill('{{');
  await prompt.press('End');
  await expect(variableSuggestions).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(variableSuggestions).toBeHidden();
  await prompt.fill('');
  await prompt.fill('{{');
  await prompt.press('End');
  await expect(variableSuggestions).toBeVisible();
  await page
    .getByText('Run an AI agent with a prompt and stream the response.', { exact: true })
    .click();
  await expect(variableSuggestions).toBeHidden();
  await prompt.fill('');
  await prompt.fill('{{start_0.query}}');
  await expect(prompt).toHaveValue('{{start_0.query}}');
  await expect(saveButton).toBeEnabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });

  const addField = page.getByRole('button', { name: 'Add field', exact: true });
  const fieldNameInputs = page.locator('input[placeholder="field_name"]');
  await expect(addField).toBeVisible();
  await addField.click();
  await expect(fieldNameInputs).toHaveCount(2);
  await addField.click();
  await expect(fieldNameInputs).toHaveCount(3);

  // Add an unconnected node and create a real port-to-port connection. The
  // seeded edges above only prove serialization; this drag exercises the
  // editor's connection gesture and edge creation path.
  const addNodeButton = page.getByRole('button', { name: 'Add Node', exact: true });
  await addNodeButton.click();
  const nodeLibrary = page.getByRole('dialog', { name: 'Add node' });
  await expect(nodeLibrary).toBeVisible();
  const addNodeBox = await addNodeButton.boundingBox();
  const nodeLibraryBox = await nodeLibrary.boundingBox();
  expect(addNodeBox).not.toBeNull();
  expect(nodeLibraryBox).not.toBeNull();
  expect(nodeLibraryBox!.y + nodeLibraryBox!.height).toBeLessThanOrEqual(addNodeBox!.y);
  expect(
    Math.abs(
      nodeLibraryBox!.x + nodeLibraryBox!.width / 2 - (addNodeBox!.x + addNodeBox!.width / 2)
    )
  ).toBeLessThanOrEqual(1);
  await page.keyboard.press('Escape');
  await expect(nodeLibrary).toBeHidden();
  await addNodeButton.click();
  await expect(nodeLibrary).toBeVisible();
  await canvas.click({ position: { x: 500, y: 500 } });
  await expect(nodeLibrary).toBeHidden();
  await addNodeButton.click();
  await expect(nodeLibrary).toBeVisible();
  const conditionNodes = page.locator('[data-node-id^="condition_"]');
  await expect(conditionNodes).toHaveCount(0);
  await page.getByTestId('demo-free-node-list-condition').click();
  await expect(conditionNodes).toHaveCount(1);
  const addedCondition = conditionNodes.first();
  await expect(addedCondition).toBeVisible();
  await expect(saveButton).toBeEnabled();
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
  await expect(conditionNodes).toHaveCount(1);
  await expect(conditionNodes.first()).toBeVisible();

  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });
  await expect(prompt).toHaveValue('{{start_0.query}}');
  await prompt.fill('{{');
  const reloadedVariables = page.getByRole('tree', { name: 'Available variables' });
  await expect(reloadedVariables).toBeVisible();
  await expect(reloadedVariables.locator('[data-variable-tree-item="global.userId"]')).toBeVisible({
    timeout: 5_000,
  });
  await expect(
    reloadedVariables.locator('[data-variable-tree-item="start_0.query"]')
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await prompt.fill('');
  await prompt.fill('{{start_0.query}}');
  await page.getByRole('button', { name: 'Close node settings' }).click();

  await endNode.scrollIntoViewIfNeeded();
  await endNode.click({ position: { x: 50, y: 15 }, force: true });
  await expect(page.getByRole('button', { name: 'Close node settings' })).toBeVisible();
  await expect(page.getByText(/The final node of the workflow/)).toBeVisible();
  const endVariablePicker = page.getByRole('button', { name: 'Select variable' });
  await expect(endVariablePicker).toBeVisible();
  await endVariablePicker.click();
  const endVariables = page.getByRole('tree', { name: 'Available variables' });
  await expect(endVariables).toBeVisible();
  for (const key of ['global.userId', 'start_0.query', 'llm_main.result']) {
    await expect(endVariables.locator(`[data-variable-tree-item="${key}"]`)).toBeVisible({
      timeout: 5_000,
    });
  }
  await page.keyboard.press('Escape');
  await expect(endVariables).toBeHidden();
  await endVariablePicker.click();
  await expect(endVariables).toBeVisible();
  await endVariables.locator('[data-variable-tree-focus="global.userId"]').click();
  await expect(endVariablePicker).toContainText('global.userId');
  await page.getByRole('button', { name: 'Close node settings' }).click();

  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText('Workflow saved', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.locator('[data-node-id="end_0"]')).toBeVisible({ timeout: 10_000 });
  await endNode.scrollIntoViewIfNeeded();
  await endNode.locator('[draggable="true"]').click({ position: { x: 50, y: 15 }, force: true });
  const persistedEndPicker = page.getByRole('button', { name: 'Select variable' });
  await expect(persistedEndPicker).toContainText('global.userId');
  await persistedEndPicker.click();
  const persistedEndVariables = page.getByRole('tree', { name: 'Available variables' });
  await expect(persistedEndVariables).toBeVisible();
  await expect(
    persistedEndVariables.locator('[data-variable-tree-item="llm_main.result"]')
  ).toBeVisible();
  await page.keyboard.press('Escape');
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
  for (const key of ['global.userId', 'start_0.query', 'llm_main.result']) {
    await expect(fullVariableTree.locator(`[data-variable-tree-item="${key}"]`)).toBeVisible({
      timeout: 5_000,
    });
  }
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
  const closeTestRun = page.locator('button[aria-label="Close"][title="Close Test Run"]');
  await expect(closeTestRun).toBeVisible();
  await closeTestRun.click();
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
