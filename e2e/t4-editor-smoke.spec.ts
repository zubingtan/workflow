import { test, expect, type Locator, type Page } from '@playwright/test';

import { buildWorkflowSchema, createWorkflow, getWorkflowSchema } from './helpers';

async function expectWithinViewport(locator: Locator, width: number, height: number) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height);
}

async function expectWorkflowSaved(page: Page) {
  const saveButton = page.locator('[data-workflow-save]');
  await expect(saveButton).toHaveAttribute('data-save-state', 'saved', { timeout: 10_000 });
  await expect(saveButton).toBeDisabled();
  await expect(page.getByText('Workflow saved', { exact: true })).toHaveCount(0);
}

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
  const conditionNodes = page.locator('[data-node-id^="condition_"]');
  await expect(conditionNodes).toHaveCount(1);
  await expect(nodeLibrary).toBeVisible();
  await page.getByTestId('demo-free-node-list-condition').click();
  await expect(conditionNodes).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(nodeLibrary).toBeHidden();
});

test('T4 agent selector chooses and persists the fake provider', async ({ page }) => {
  const workflowName = `E2E T4 Agent Select ${Date.now()}`;

  await page.route('**/agents', async (route) => {
    if (route.request().method() === 'GET')
      await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });

  await page.addInitScript(() => localStorage.setItem('workflow-theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/workflows');
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByPlaceholder('Workflow name').fill(workflowName);
  await page.getByRole('button', { name: 'OK' }).click();

  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });
  const agentSelect = page.locator('button[role="combobox"][aria-label="Agent"]').last();
  await expect(agentSelect).toBeVisible();
  await expect(agentSelect).toBeDisabled();
  await expect(agentSelect).toHaveAttribute('aria-busy', 'true');
  await expect(agentSelect).toBeEnabled({ timeout: 5_000 });
  await agentSelect.click();
  const fakeAgentOption = page.getByRole('option', { name: /Fake Provider \(fake-m0\)/ });
  await expect(fakeAgentOption).toBeVisible();
  const selectPopup = page.locator('[data-slot="select-content"]').last();
  const agentSelectBox = await agentSelect.boundingBox();
  const selectPopupBox = await selectPopup.boundingBox();
  expect(agentSelectBox).not.toBeNull();
  expect(selectPopupBox).not.toBeNull();
  expect(selectPopupBox!.x).toBeCloseTo(agentSelectBox!.x, 0);
  expect(selectPopupBox!.y).toBeCloseTo(agentSelectBox!.y + agentSelectBox!.height, 0);
  await expect(
    await fakeAgentOption.evaluate((element) =>
      Boolean(element.closest('[data-ui="editor-overlay-root"]'))
    )
  ).toBe(true);
  await fakeAgentOption.click();
  await expect(agentSelect).toContainText('Fake Provider (fake-m0)');

  const saveButton = page.getByRole('button', { name: 'Save', exact: true });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expectWorkflowSaved(page);
  const savedStateButton = page.locator('[data-workflow-save]');
  await expect(savedStateButton).toHaveAttribute('data-save-state', 'idle', {
    timeout: 5_000,
  });
  await expect(savedStateButton).toHaveClass(/bg-secondary/);
  await page.reload();
  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });
  await expect(
    page.locator('button[role="combobox"][aria-label="Agent"]:not(:disabled)')
  ).toContainText('Fake Provider (fake-m0)');
});

test('T4 schema editor keeps recursive object and array fields editable', async ({ page }) => {
  const workflowName = `E2E T4 Schema ${Date.now()}`;

  await page.addInitScript(() => localStorage.setItem('workflow-theme', 'light'));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/workflows');
  await page.getByRole('button', { name: 'New workflow' }).click();
  await page.getByPlaceholder('Workflow name').fill(workflowName);
  await page.getByRole('button', { name: 'OK' }).click();

  await page.locator('[data-node-id="start_0"]').click({ position: { x: 10, y: 10 } });
  const addField = page.getByRole('button', { name: 'Add field', exact: true });
  await expect(addField).toBeVisible();
  await addField.click();

  const rootType = page.getByRole('combobox', { name: 'Schema type field' });
  await rootType.click();
  await page.getByRole('option', { name: 'object', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add field', exact: true })).toHaveCount(2);

  await page.getByRole('button', { name: 'Add field', exact: true }).last().click();
  const nestedType = page.getByRole('combobox', { name: 'Schema type field' }).last();
  await nestedType.click();
  await page.getByRole('option', { name: 'array', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /items type$/ })).toBeVisible();
  const description = page.getByRole('textbox', { name: 'Schema field field description' }).last();
  await description.fill('Nested values');
  await page.getByRole('checkbox', { name: 'Required field' }).last().click();
  await expect(description).toHaveValue('Nested values');

  await page.getByRole('button', { name: 'Close node settings' }).click();
});

test('T4 schema defaults reset by type and preserve structured drafts across reload', async ({
  page,
}) => {
  const workflowName = `E2E T4 Schema Defaults ${Date.now()}`;
  const schema = buildWorkflowSchema('fake-agent', '') as any;
  const start = schema.nodes.find((node: any) => node.id === 'start_0');
  start.data.outputs = {
    type: 'object',
    properties: { field: { type: 'string', default: 'legacy' } },
  };
  const workflowId = await createWorkflow(workflowName, schema);

  await page.goto(`/#/workflows/${workflowId}`);
  await page.locator('[data-node-id="start_0"]').click({ position: { x: 10, y: 10 } });
  const fieldDefault = page.getByRole('textbox', { name: 'Schema field field default' });
  await expect(fieldDefault).toHaveValue('legacy');
  const fieldType = page.getByRole('combobox', { name: 'Schema type field' });
  await fieldType.click();
  await page.getByRole('option', { name: 'object', exact: true }).click();
  await expect(fieldDefault).toHaveValue('{}');

  await fieldDefault.fill('{"draft":');
  await fieldDefault.press('Tab');
  await expect(fieldDefault).toHaveValue('{}');
  await fieldDefault.fill('{"draft":true}');
  await fieldDefault.press('Tab');
  await expect(fieldDefault).toHaveValue('{"draft":true}');

  await page.getByRole('button', { name: 'Close node settings' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expectWorkflowSaved(page);
  await page.reload();
  await page.locator('[data-node-id="start_0"]').click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('textbox', { name: 'Schema field field default' })).toHaveValue(
    '{"draft":true}'
  );

  const saved = await getWorkflowSchema(workflowId);
  const savedStart = saved.nodes.find((node: any) => node.id === 'start_0');
  expect(savedStart.data.outputs.properties.field).toMatchObject({
    type: 'object',
    default: { draft: true },
  });
});

test('T4 schema editor preserves root array items and schema order metadata', async ({ page }) => {
  const workflowName = `E2E T4 Root Array ${Date.now()}`;
  const schema = buildWorkflowSchema('fake-agent', 'root array') as any;
  const start = schema.nodes.find((node: any) => node.id === 'start_0');
  start.data.outputs = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        late: { type: 'string', extra: { index: 2 } },
        early: { type: 'string', extra: { index: 1 } },
      },
    },
  };
  const workflowId = await createWorkflow(workflowName, schema);

  await page.goto(`/#/workflows/${workflowId}`);
  await page.locator('[data-node-id="start_0"]').click({ position: { x: 10, y: 10 } });
  await expect(page.getByRole('combobox', { name: 'Schema type', exact: true })).toContainText(
    'array'
  );
  await expect(page.getByRole('combobox', { name: 'Schema items type' })).toContainText('object');
  await expect(page.getByRole('button', { name: 'Add field', exact: true })).toHaveCount(1);

  const itemFields = page.locator(
    'input[aria-label^="Schema field "]:not([aria-label$=" description"]):not([aria-label$=" default"])'
  );
  await expect(itemFields).toHaveCount(2);
  await expect(itemFields.nth(0)).toHaveValue('early');
  await expect(itemFields.nth(1)).toHaveValue('late');
  await page.getByRole('textbox', { name: 'Schema field early description' }).fill('Kept order');
  start.data.outputs.items.properties.early.description = 'Kept order';
  await page.getByRole('button', { name: 'Close node settings' }).click();
  const saveButton = page.getByRole('button', { name: 'Save', exact: true });
  await saveButton.click();
  await expectWorkflowSaved(page);

  const saved = await getWorkflowSchema(workflowId);
  const savedStart = saved.nodes.find((node: any) => node.id === 'start_0');
  expect(savedStart.data.outputs).toEqual(start.data.outputs);
});

test('T4 variable picker preserves schema keys that contain dots', async ({ page }) => {
  const workflowName = `E2E T4 Dotted Variable ${Date.now()}`;
  const schema = buildWorkflowSchema('fake-agent', '') as any;
  const start = schema.nodes.find((node: any) => node.id === 'start_0');
  start.data.outputs = {
    type: 'object',
    properties: { 'a.b': { type: 'string' } },
  };
  const workflowId = await createWorkflow(workflowName, schema);

  await page.goto(`/#/workflows/${workflowId}`);
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });
  const prompt = page.locator('[data-template-editor="true"] .cm-content[contenteditable="true"]');
  await prompt.click();
  await page.keyboard.type('{{');
  const variables = page.getByRole('tree', { name: 'Available variables' });
  await expect(variables.locator('[data-variable-tree-item="start_0.a.b"]')).toBeVisible();
  let selected = false;
  for (let index = 0; index < 40; index += 1) {
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-variable-tree-focus')
    );
    if (focused === 'start_0.a.b') {
      await page.keyboard.press('Enter');
      selected = true;
      break;
    }
    await page.keyboard.press('ArrowDown');
  }
  expect(selected).toBe(true);
  const variableChip = prompt.locator('.cm-variable-chip');
  await expect(variableChip).toHaveAttribute('title', '{{start_0.a.b}}');
  await page.getByRole('button', { name: 'Close node settings' }).click();

  const saveButton = page.getByRole('button', { name: 'Save', exact: true });
  await saveButton.click();
  await expectWorkflowSaved(page);
  await page.reload();
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });
  await expect(prompt.locator('.cm-variable-chip')).toHaveAttribute('title', '{{start_0.a.b}}');

  const saved = await getWorkflowSchema(workflowId);
  const savedLlm = saved.nodes.find((node: any) => node.id === 'llm_main');
  expect(savedLlm.data.inputsValues.prompt.content).toBe('{{start_0.a.b}}');
});

test('T4 JSON editor inserts a variable through the real keyboard menu and persists it', async ({
  page,
}) => {
  const workflowName = `E2E T4 JSON Variable ${Date.now()}`;
  const schema = buildWorkflowSchema('fake-agent', '') as any;
  schema.nodes = schema.nodes.filter((node: any) => node.id !== 'llm_main');
  schema.edges = [{ sourceNodeID: 'start_0', targetNodeID: 'end_0' }];
  const http = {
    id: 'http_0',
    type: 'http',
    meta: { position: { x: 540, y: 300 } },
    data: {
      title: 'HTTP_0',
      api: { method: 'POST' },
      body: { bodyType: 'JSON', json: { type: 'template', content: '' } },
      headers: {},
      params: {},
      outputs: { type: 'object', properties: { body: { type: 'string' } } },
    },
  };
  schema.nodes.push(http);
  const workflowId = await createWorkflow(workflowName, schema);

  await page.goto(`/#/workflows/${workflowId}`);
  await page.locator('[data-node-id="http_0"]').click({ position: { x: 10, y: 10 } });
  const jsonEditor = page
    .locator('[data-json-editor="true"] .cm-content[contenteditable="true"]')
    .last();
  await expect(jsonEditor).toBeVisible();
  // The HTTP card can be vertically scrolled while its schema summary is
  // rendered above the editor. Click the editor's upper-left content area,
  // which is the same caret entry point a user sees after scrolling the card.
  await jsonEditor.click({ position: { x: 12, y: 12 } });
  await page.keyboard.type('@');
  const atVariables = page.getByRole('tree', { name: 'Available variables' });
  await expect(atVariables).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(atVariables).toBeHidden();
  await jsonEditor.fill('');
  await page.keyboard.type('{{');
  const variables = page.getByRole('tree', { name: 'Available variables' });
  await expect(variables).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(jsonEditor.locator('.cm-variable-chip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close node settings' }).click();

  const saveButton = page.getByRole('button', { name: 'Save', exact: true });
  await saveButton.click();
  await expectWorkflowSaved(page);
  const saved = await getWorkflowSchema(workflowId);
  const savedHttp = saved.nodes.find((node: any) => node.id === 'http_0');
  expect(savedHttp.data.body.json.content).toMatch(/^\{\{.+\}\}$/);
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
  const prompt = page.locator('[data-template-editor="true"] .cm-content[contenteditable="true"]');
  const nodePanel = page.locator('.gedit-flow-panel-wrap').filter({
    has: page.locator('[data-node-form-panel]'),
  });
  const nodePanelHeader = nodePanel.locator('[data-node-form-header]');
  await expect(nodePanel).toBeVisible();
  await expect(nodePanelHeader).toBeVisible();
  await expect.poll(async () => Boolean(await nodePanel.boundingBox())).toBe(true);
  await expect.poll(async () => Boolean(await nodePanelHeader.boundingBox())).toBe(true);
  const panelBeforeDrag = await nodePanel.boundingBox();
  const headerBox = await nodePanelHeader.boundingBox();
  expect(panelBeforeDrag).not.toBeNull();
  expect(headerBox).not.toBeNull();
  await page.mouse.move(headerBox!.x + headerBox!.width / 2, headerBox!.y + headerBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    headerBox!.x + headerBox!.width / 2 + 24,
    headerBox!.y + headerBox!.height / 2 + 18
  );
  await page.mouse.up();
  const panelAfterDrag = await nodePanel.boundingBox();
  expect(panelAfterDrag).not.toBeNull();
  expect(panelAfterDrag!.x).not.toBe(panelBeforeDrag!.x);
  expect(panelAfterDrag!.y).not.toBe(panelBeforeDrag!.y);
  const titleBox = await nodePanelHeader.locator('span.block.truncate').boundingBox();
  const headerAfterDragBox = await nodePanelHeader.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(headerAfterDragBox).not.toBeNull();
  expect(
    Math.abs(
      titleBox!.y + titleBox!.height / 2 - (headerAfterDragBox!.y + headerAfterDragBox!.height / 2)
    )
  ).toBeLessThanOrEqual(3);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const headerAfterFirstDrag = await nodePanelHeader.boundingBox();
  expect(headerAfterFirstDrag).not.toBeNull();
  await page.mouse.move(
    headerAfterFirstDrag!.x + headerAfterFirstDrag!.width / 2,
    headerAfterFirstDrag!.y + headerAfterFirstDrag!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    headerAfterFirstDrag!.x + headerAfterFirstDrag!.width / 2,
    viewport!.height - 4
  );
  await page.mouse.up();
  const panelAfterBottomDrag = await nodePanel.boundingBox();
  expect(panelAfterBottomDrag).not.toBeNull();
  expect(panelAfterBottomDrag!.y + panelAfterBottomDrag!.height).toBeLessThanOrEqual(
    viewport!.height
  );
  const resizeBar = nodePanel.locator(':scope > div').first();
  const resizeBarBox = await resizeBar.boundingBox();
  expect(resizeBarBox).not.toBeNull();
  await page.mouse.move(
    resizeBarBox!.x + resizeBarBox!.width / 2,
    resizeBarBox!.y + resizeBarBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    resizeBarBox!.x + resizeBarBox!.width / 2 - 24,
    resizeBarBox!.y + resizeBarBox!.height / 2
  );
  await page.mouse.up();
  await expect
    .poll(async () => (await nodePanel.boundingBox())?.width ?? 0)
    .toBeGreaterThan(panelAfterDrag!.width + 10);
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
  await expect(prompt).toContainText('{{continued');
  await expect(prompt).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(variableSuggestions).toBeHidden();
  await expect(prompt).toBeFocused();

  await prompt.fill('{{');
  await prompt.press('End');
  await expect(variableSuggestions).toBeVisible();
  const variableTreeItems = variableSuggestions.locator('[data-variable-tree-focus]:visible');
  await expect(variableTreeItems.first()).toBeVisible();
  await prompt.press('ArrowDown');
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
  await page.keyboard.press('Home');
  for (let index = 0; index < 40; index += 1) {
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-variable-tree-focus')
    );
    if (focused === 'start_0') break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(variableBranchButton).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(variableBranch).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(variableBranch).toHaveAttribute('aria-expanded', 'true');

  await variableTreeItems.last().press('Enter');
  await expect(variableSuggestions).toBeHidden();
  const variableChip = prompt.locator('.cm-variable-chip');
  await expect(variableChip).toHaveCount(1);
  await expect(variableChip).toHaveAttribute('title', /^\{\{.+\}\}$/);
  await expect(prompt.locator('.cm-line.cm-activeLine')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)'
  );
  await expect(variableChip).toHaveCSS('vertical-align', 'middle');
  await expect(variableChip).toHaveCSS('white-space', 'nowrap');
  const promptLineMetrics = await prompt.locator('.cm-line').evaluate((line) => {
    const chip = line.querySelector<HTMLElement>('.cm-variable-chip');
    const lineBox = line.getBoundingClientRect();
    const chipBox = chip?.getBoundingClientRect();
    return {
      lineHeight: Number.parseFloat(getComputedStyle(line).lineHeight),
      lineBoxHeight: lineBox.height,
      chipBoxHeight: chipBox?.height ?? 0,
      chipTopGap: chipBox ? chipBox.top - lineBox.top : 0,
      chipBottomGap: chipBox ? lineBox.bottom - chipBox.bottom : 0,
    };
  });
  expect(promptLineMetrics.lineBoxHeight).toBeGreaterThanOrEqual(
    promptLineMetrics.chipBoxHeight + 4
  );
  expect(promptLineMetrics.chipTopGap).toBeGreaterThanOrEqual(1);
  expect(promptLineMetrics.chipBottomGap).toBeGreaterThanOrEqual(1);
  await prompt.fill(
    'This prompt is intentionally long so the editor wraps its content inside the prompt field instead of scrolling it horizontally. {{start_0.query}}'
  );
  const wrappedLineMetrics = await prompt.locator('.cm-line').evaluate((line) => {
    const scroller = line.closest('.cm-scroller');
    const styles = getComputedStyle(line);
    return {
      lineHeight: Number.parseFloat(styles.lineHeight),
      lineHeightPx: line.getBoundingClientRect().height,
      scrollWidth: scroller?.scrollWidth ?? 0,
      clientWidth: scroller?.clientWidth ?? 0,
    };
  });
  expect(wrappedLineMetrics.lineHeightPx).toBeGreaterThan(wrappedLineMetrics.lineHeight);
  expect(wrappedLineMetrics.scrollWidth).toBeLessThanOrEqual(wrappedLineMetrics.clientWidth);
  await prompt.fill('Selectable prompt text');
  await prompt.press('ControlOrMeta+A');
  const selectionBackground = page
    .locator('[data-template-editor="true"] .cm-selectionBackground')
    .first();
  await expect(selectionBackground).toBeVisible();
  const selectionBackgroundColor = await selectionBackground.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(selectionBackgroundColor).not.toMatch(/204,\s*238,\s*255|153,\s*238,\s*255/);
  await prompt.fill('{{start_0.query}}');
  await variableChip.hover();
  const variableChipPopover = page.locator('[data-variable-chip-popover="true"]');
  await expect(variableChipPopover).toBeVisible();
  await expect(variableChipPopover).toContainText(/global\.userId|start_0\.query|llm_main\.result/);
  await page.mouse.move(10, 10);
  await expect(variableChipPopover).toBeHidden();
  await expect(prompt).toBeFocused();

  await prompt.fill('{{');
  await prompt.press('End');
  await expect(variableSuggestions).toBeVisible();
  await variableSuggestions.locator('[data-variable-tree-focus="global.userId"]').click();
  await expect(variableChip).toHaveAttribute('title', '{{global.userId}}');
  await prompt.fill('');
  await prompt.fill('{{');
  await prompt.press('End');
  await expect(variableSuggestions).toBeVisible();
  await variableSuggestions.getByRole('button', { name: /query/ }).click();
  await expect(variableChip).toHaveAttribute('title', '{{start_0.query}}');
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
  await expect(variableChip).toHaveAttribute('title', '{{start_0.query}}');
  await variableChip.hover();
  await expect(variableChipPopover).toContainText('start_0.query');
  await prompt.fill('{{missing.value}}');
  await expect(variableChip).toHaveAttribute('data-variable-unknown', 'true');
  await variableChip.hover();
  await expect(variableChipPopover).toContainText('Undefined variable');
  await prompt.fill('{{start_0.query}}');
  await expect(saveButton).toBeEnabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unsaved Changes' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await page.locator('[data-node-id="llm_main"]').click({ position: { x: 10, y: 10 } });

  const addField = page.getByRole('button', { name: 'Add field', exact: true });
  const fieldNameInputs = page.locator('input[placeholder="field_name"]');
  await expect(addField).toBeVisible();
  const schemaFields = page.locator('[data-structured-output-fields]:visible').last();
  const addFieldSurface = page.locator('[data-structured-output-add-field]:visible').last();
  await expect(schemaFields).toBeVisible();
  await expect(addFieldSurface).toBeVisible();
  await expect
    .poll(async () => {
      const [fieldsWidth, addWidth] = await Promise.all([
        schemaFields.evaluate((element) => element.getBoundingClientRect().width).catch(() => 0),
        addFieldSurface.evaluate((element) => element.getBoundingClientRect().width).catch(() => 0),
      ]);
      return fieldsWidth > 0 && addWidth > 0 && Math.abs(addWidth - fieldsWidth) < 1;
    })
    .toBe(true);
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
  const lineNodePanel = page.locator('[data-node-panel="true"]');
  await expect(lineNodePanel).toBeVisible();
  await expect(
    await lineNodePanel.evaluate((element) =>
      Boolean(element.closest('[data-ui="editor-overlay-root"]'))
    )
  ).toBe(true);
  await expectWithinViewport(lineNodePanel, 1440, 900);
  await page.keyboard.press('Escape');
  await expect(lineNodePanel).toBeHidden();
  await expect(canvas).toBeFocused();
  await page.locator('.gedit-flow-activity-edge').first().hover();
  await lineAddButton.click();
  await expect(lineNodePanel).toBeVisible();
  await page.mouse.click(500, 500);
  await expect(lineNodePanel).toBeHidden();
  await page.locator('.gedit-flow-activity-edge').first().hover();
  await lineAddButton.click();
  await expect(lineNodePanel).toBeVisible();
  await page.getByTestId('demo-free-node-list-code').click();
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
  await expect(page.locator('.gedit-flow-activity-edge')).toHaveCount(4);
  await expect(page.locator('[data-node-id^="code_"]')).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath('t4-editor-1440x900-light.png'),
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Layout Direction: Horizontal' }).click();
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await saveButton.click();
  await expectWorkflowSaved(page);

  await page.reload();
  await expect(page.locator('[data-node-id="start_0"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible();
  await expect(page.locator('[data-node-id="end_0"]')).toBeVisible();
  await expect(page.locator('.gedit-flow-activity-edge')).toHaveCount(4);
  await expect(page.locator('[data-node-id^="code_"]')).toHaveCount(1);
  await expect(conditionNodes).toHaveCount(1);
  await expect(conditionNodes.first()).toBeVisible();

  const reloadedLlmNode = page.locator('[data-node-id="llm_main"]');
  await reloadedLlmNode.scrollIntoViewIfNeeded();
  const reloadedLlmBox = await reloadedLlmNode.boundingBox();
  expect(reloadedLlmBox).not.toBeNull();
  await page.mouse.click(reloadedLlmBox!.x + 24, reloadedLlmBox!.y + 24);
  await expect(page.getByRole('button', { name: 'Close node settings' })).toBeVisible();
  await expect(
    page.locator('[data-template-editor="true"] .cm-variable-chip:visible').last()
  ).toHaveAttribute('title', '{{start_0.query}}');
  const closeNodeSettings = page.getByRole('button', { name: 'Close node settings' });
  await closeNodeSettings.click();
  await expect(closeNodeSettings).toBeHidden();

  await endNode.scrollIntoViewIfNeeded();
  await endNode.locator('[data-node-surface]').dispatchEvent('click');
  await expect(closeNodeSettings).toBeVisible();
  await expect(page.getByText(/The final node of the workflow/)).toBeVisible();
  const endInputKey = page.locator('[data-input-key="result"]');
  await expect(endInputKey).toBeVisible();
  await endInputKey.fill('summary');
  await endInputKey.press('Enter');
  await expect(page.locator('[data-input-key="summary"]')).toBeVisible();
  const endVariablePicker = page.locator('[data-variable-picker="true"]').last();
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
  await expect(endVariablePicker).toHaveAttribute('title', 'global.userId');
  await page.getByRole('button', { name: 'Close node settings' }).click();

  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expectWorkflowSaved(page);
  await page.reload();
  await expect(page.locator('[data-node-id="end_0"]')).toBeVisible({ timeout: 10_000 });
  await endNode.scrollIntoViewIfNeeded();
  await endNode.locator('[data-node-surface]').dispatchEvent('click');
  await expect(page.locator('[data-input-key="summary"]')).toBeVisible();
  const persistedEndPicker = page.locator('[data-variable-picker="true"]').last();
  await expect(persistedEndPicker).toHaveAttribute('title', 'global.userId');
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
  const variablePanel = page.getByRole('dialog', { name: 'Variable panel' });
  await expect(variablePanel).toBeVisible();
  await expectWithinViewport(variablePanel, 1440, 900);
  const fullVariableTree = page
    .locator('[role="tree"][aria-label="Available variables"]:visible')
    .last();
  await expect(fullVariableTree).toBeVisible();
  await variablePanelToggle.press('Tab');
  const variableListTab = page.getByRole('tab', { name: /Variable list/ });
  const globalEditorTab = page.getByRole('tab', { name: 'Global editor' });
  const variableListPanel = page.locator('#variable-panel-panel-list');
  const globalEditorPanel = page.locator('#variable-panel-panel-global');
  await expect(variableListTab).toBeFocused();
  await expect(variableListTab).toHaveAttribute('aria-controls', 'variable-panel-panel-list');
  await expect(globalEditorTab).toHaveAttribute('aria-controls', 'variable-panel-panel-global');
  await expect(variableListPanel).toBeVisible();
  await expect(globalEditorPanel).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(globalEditorTab).toBeFocused();
  await expect(globalEditorTab).toHaveAttribute('aria-selected', 'true');
  await expect(globalEditorPanel).toBeVisible();
  await expect(variableListPanel).toBeHidden();
  await page.keyboard.press('ArrowLeft');
  await expect(variableListTab).toBeFocused();
  await expect(variableListPanel).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
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
  await fullVariableTree.press('Home');
  for (let index = 0; index < 40; index += 1) {
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute('data-variable-tree-focus')
    );
    if (focused === 'llm_main') break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(fullVariableBranch.locator('[data-variable-tree-focus]').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(fullVariableBranch).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(fullVariableBranch).toHaveAttribute('aria-expanded', 'true');
  await variablePanelToggle.click();

  await page.setViewportSize({ width: 720, height: 900 });
  await variablePanelToggle.click();
  await expect(variablePanel).toBeVisible();
  await expectWithinViewport(variablePanel, 720, 900);
  await variablePanelToggle.click();
  await page.screenshot({
    path: testInfo.outputPath('t4-editor-720x900-narrow.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  const tools = page.locator('.workflow-tools');
  await tools.getByRole('button', { name: 'Test Run', exact: true }).click();
  await expect(page.getByText('Input Form', { exact: true })).toBeVisible();
  const jsonMode = page.getByRole('checkbox', { name: 'JSON Mode' });
  await jsonMode.click();
  const jsonValueEditor = page.locator(
    '[data-json-value-editor="true"] .cm-content[contenteditable="true"]'
  );
  await expect(jsonValueEditor).toBeVisible();
  await jsonValueEditor.fill('{"query":"smoke"}');
  await expect(jsonValueEditor).toBeFocused();
  await jsonMode.click();
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
