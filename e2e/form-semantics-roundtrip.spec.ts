import { expect, test } from '@playwright/test';

import { createWorkflow, getWorkflowSchema } from './helpers';

function buildSemanticRoundTripSchema() {
  return {
    direction: 'LR',
    globalVariable: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: [],
    },
    futureDocumentField: { preserved: true },
    nodes: [
      {
        id: 'start_0',
        type: 'start',
        meta: { position: { x: 100, y: 300 } },
        data: {
          title: 'Start',
          outputs: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'string' } },
              query: { type: 'string', default: 'Hello' },
            },
          },
          futureNodeField: { nested: ['kept'] },
        },
      },
      {
        id: 'code_0',
        type: 'code',
        meta: { position: { x: 300, y: 300 } },
        data: {
          title: 'Code',
          inputsValues: {
            expressionValue: { type: 'expression', content: 'start_0.query' },
            templateValue: { type: 'template', content: 'Hello {{start_0.query}}' },
            nestedValue: {
              child: { type: 'constant', content: 'before', schema: { type: 'string' } },
            },
          },
          inputs: {
            type: 'object',
            properties: {
              expressionValue: { type: 'string' },
              templateValue: { type: 'string' },
              nestedValue: { type: 'object', properties: { child: { type: 'string' } } },
            },
          },
          script: { language: 'javascript', content: 'return params;' },
          outputs: { type: 'object', properties: { result: { type: 'string' } } },
          futureCodeField: { preserved: true },
        },
      },
      {
        id: 'condition_0',
        type: 'condition',
        meta: { position: { x: 500, y: 300 } },
        data: {
          title: 'Condition',
          conditions: [
            {
              key: 'if_0',
              value: {
                left: { type: 'ref', content: ['start_0', 'query'] },
                operator: 'eq',
                right: { type: 'constant', content: 'Hello' },
              },
            },
          ],
          futureConditionField: { preserved: true },
        },
      },
      {
        id: 'loop_0',
        type: 'loop',
        meta: { position: { x: 500, y: 600 } },
        data: {
          title: 'Loop',
          loopFor: { type: 'ref', content: ['start_0', 'items'], extra: { index: 3 } },
          loopOutputs: {
            item: { type: 'ref', content: ['start_0', 'items'] },
          },
          futureLoopField: { preserved: true },
        },
        blocks: [
          {
            id: 'block_start_0',
            type: 'block-start',
            meta: { position: { x: 32, y: 0 } },
            data: { futureBlockField: { preserved: true } },
          },
          {
            id: 'block_end_0',
            type: 'block-end',
            meta: { position: { x: 192, y: 0 } },
            data: {},
          },
        ],
      },
      {
        id: 'end_0',
        type: 'end',
        meta: { position: { x: 900, y: 300 } },
        data: {
          title: 'End',
          inputsValues: {
            result: { type: 'ref', content: ['start_0', 'query'], extra: { index: 0 } },
          },
          inputs: { type: 'object', properties: { result: { type: 'string' } } },
        },
      },
    ],
    edges: [
      { sourceNodeID: 'start_0', targetNodeID: 'code_0' },
      { sourceNodeID: 'start_0', targetNodeID: 'loop_0' },
      { sourceNodeID: 'code_0', targetNodeID: 'condition_0' },
      { sourceNodeID: 'condition_0', sourcePortID: 'if_0', targetNodeID: 'end_0' },
    ],
  };
}

test('editor preserves headless form semantics across load/edit/save/reload', async ({ page }) => {
  const name = `E2E Form Semantics ${Date.now()}`;
  const workflowId = await createWorkflow(name, buildSemanticRoundTripSchema());

  await page.goto('/');
  await page.getByText('Workflows', { exact: true }).first().click();
  await page
    .getByTestId('workflow-row')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Open' })
    .click();
  await expect(page.locator('[data-node-id="condition_0"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-node-id="code_0"]')).toBeVisible();
  await expect(page.locator('[data-node-id="loop_0"]')).toBeVisible();
  await expect(page.locator('[data-node-id="block_start_0"]')).toBeVisible();

  // Exercise the migrated loop controls through the real panel: inspect the
  // private loop scope, select an output mapping, rename it, and add/remove a
  // temporary mapping before saving.
  const closeInitialPanel = page.getByRole('button', { name: 'Close node settings' });
  if (await closeInitialPanel.isVisible()) await closeInitialPanel.click();
  await page.locator('[data-node-id="loop_0"]').getByText('Loop', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close node settings' })).toBeVisible();
  const loopInputPicker = page.locator('[data-batch-variable-selector="true"]').last();
  await expect(loopInputPicker).toBeVisible();
  await loopInputPicker.click();
  const loopVariables = page.getByRole('tree', { name: 'Available variables' }).last();
  const loopSource = loopVariables.locator('[data-variable-tree-item="start_0.items"]');
  await expect(loopSource).toBeVisible();
  await expect(loopInputPicker.locator('button[aria-label="Select variable"]')).toHaveAttribute(
    'title',
    'start_0.items'
  );
  await page.keyboard.press('Escape');
  await expect(loopVariables).toBeHidden();

  const loopOutputKey = page.locator('[data-output-key="item"]');
  await expect(loopOutputKey).toBeVisible();
  const loopOutputRow = page.locator('[data-output-row="item"]');
  const loopOutputPicker = loopOutputRow.getByRole('button', { name: 'Select variable' });
  await loopOutputPicker.click();
  const outputVariables = page.getByRole('tree', { name: 'Available variables' }).last();
  await expect(
    outputVariables.locator('[data-variable-tree-item="loop_0_locals.item"]')
  ).toBeVisible();
  await outputVariables.locator('[data-variable-tree-focus="loop_0_locals.item"]').click();
  await expect(loopOutputPicker).toHaveAttribute('title', 'loop_0_locals.item');
  await loopOutputKey.fill('renamed');
  await loopOutputKey.press('Enter');
  await expect(page.locator('[data-output-key="renamed"]')).toBeVisible();
  const renamedBack = page.locator('[data-output-key="renamed"]');
  await renamedBack.fill('item');
  await renamedBack.press('Enter');
  await expect(page.locator('[data-output-key="item"]')).toBeVisible();
  await expect(
    page.locator('[data-output-row="item"] [data-variable-picker="true"]')
  ).toHaveAttribute('title', 'loop_0_locals.item');

  const loopAdd = page.getByRole('button', { name: 'Add', exact: true }).last();
  const temporaryOutputName = page.getByPlaceholder('Output name');
  await temporaryOutputName.fill('temporary');
  await expect(loopAdd).toBeEnabled();
  await loopAdd.click();
  const temporaryOutput = page.locator('[data-output-key="temporary"]');
  await expect(temporaryOutput).toBeVisible();
  await page.getByRole('button', { name: 'Remove output temporary' }).click();
  await expect(page.locator('[data-output-key="item"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close node settings' }).click();

  // Nested inputs must remain editable as a tree, not be flattened into a
  // single leaf when the migrated form loads an existing workflow.
  await page.locator('[data-node-id="code_0"]').click();
  const nestedInput = page.locator('[data-input-group="nestedValue"]');
  await expect(
    nestedInput.getByRole('button', { name: 'Collapse input nestedValue' })
  ).toBeVisible();
  const nestedValue = nestedInput.locator(
    '[data-editor-control="dynamic-value"] input[type="text"]'
  );
  await expect(nestedValue).toHaveValue('before');
  await nestedValue.fill('after');
  await nestedValue.press('Enter');

  // A real form edit: add a Condition branch and let FlowGram rebuild its
  // dynamic output port before the document is saved.
  await page.locator('[data-node-id="condition_0"]').click();
  const addConditionButton = page.getByRole('button', { name: 'plus Add', exact: true }).last();
  await expect(addConditionButton).toBeVisible({ timeout: 10_000 });
  await addConditionButton.click();
  await expect(
    page.locator('[data-node-id="condition_0"] [data-port-id][data-port-type="output"]')
  ).toHaveCount(3);

  // A real editor edit: this exercises dynamic ports and FlowGram's nested
  // document serialization before the app's Save path is invoked.
  await page.getByRole('button', { name: 'Layout Direction: Horizontal' }).click();
  const saveButton = page.getByRole('button', { name: 'Save', exact: true }).first();
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await saveButton.click();
  await expect(page.getByText('Workflow saved', { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.locator('[data-node-id="condition_0"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-node-id="code_0"]')).toBeVisible();
  await expect(
    page.locator('[data-node-id="condition_0"] [data-port-id][data-port-type="output"]')
  ).toHaveCount(3);

  const saved = await getWorkflowSchema(workflowId);
  expect(saved.direction).toBe('TB');
  expect(saved.futureDocumentField).toEqual({ preserved: true });
  expect(saved.globalVariable).toEqual(buildSemanticRoundTripSchema().globalVariable);
  expect(saved.edges).toEqual(buildSemanticRoundTripSchema().edges);

  const start = saved.nodes.find((node: any) => node.id === 'start_0');
  const condition = saved.nodes.find((node: any) => node.id === 'condition_0');
  const code = saved.nodes.find((node: any) => node.id === 'code_0');
  const loop = saved.nodes.find((node: any) => node.id === 'loop_0');
  expect(start.data.futureNodeField).toEqual({ nested: ['kept'] });
  expect(condition.data.futureConditionField).toEqual({ preserved: true });
  expect(condition.data.conditions).toHaveLength(2);
  expect(code.data.futureCodeField).toEqual({ preserved: true });
  expect(code.data.inputsValues).toMatchObject({
    expressionValue: { type: 'expression', content: 'start_0.query' },
    templateValue: { type: 'template', content: 'Hello {{start_0.query}}' },
    nestedValue: {
      child: { type: 'constant', content: 'after', schema: { type: 'string' } },
    },
  });
  expect(loop.data.futureLoopField).toEqual({ preserved: true });
  expect(loop.data.loopFor).toEqual({
    type: 'ref',
    content: ['start_0', 'items'],
    extra: { index: 3 },
  });
  expect(loop.data.loopOutputs).toEqual({
    item: {
      type: 'ref',
      content: ['loop_0_locals', 'item'],
    },
  });
  expect(loop.blocks.find((node: any) => node.id === 'block_start_0').data).toEqual({
    futureBlockField: { preserved: true },
  });
});
