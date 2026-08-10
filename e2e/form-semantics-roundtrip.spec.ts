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
      { sourceNodeID: 'start_0', targetNodeID: 'condition_0' },
      { sourceNodeID: 'condition_0', sourcePortID: 'if_0', targetNodeID: 'end_0' },
    ],
  };
}

test('editor preserves headless form semantics across load/edit/save/reload', async ({ page }) => {
  const name = `E2E Form Semantics ${Date.now()}`;
  const workflowId = await createWorkflow(name, buildSemanticRoundTripSchema());

  await page.goto('/');
  await page.getByText('Workflows', { exact: true }).first().click();
  await page.locator('tr', { hasText: name }).getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('[data-node-id="condition_0"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-node-id="loop_0"]')).toBeVisible();
  await expect(page.locator('[data-node-id="block_start_0"]')).toBeVisible();

  // A real editor edit: this exercises dynamic ports and FlowGram's nested
  // document serialization before the app's Save path is invoked.
  await page.getByRole('button', { name: 'Layout Direction: Horizontal' }).click();
  const saveButton = page.getByRole('button', { name: 'Save', exact: true }).first();
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await saveButton.click();
  await expect(page.getByText('Workflow saved', { exact: true })).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.locator('[data-node-id="condition_0"]')).toBeVisible({ timeout: 10_000 });

  const saved = await getWorkflowSchema(workflowId);
  expect(saved.direction).toBe('TB');
  expect(saved.futureDocumentField).toEqual({ preserved: true });
  expect(saved.globalVariable).toEqual(buildSemanticRoundTripSchema().globalVariable);
  expect(saved.edges).toEqual(buildSemanticRoundTripSchema().edges);

  const start = saved.nodes.find((node: any) => node.id === 'start_0');
  const condition = saved.nodes.find((node: any) => node.id === 'condition_0');
  const loop = saved.nodes.find((node: any) => node.id === 'loop_0');
  expect(start.data.futureNodeField).toEqual({ nested: ['kept'] });
  expect(condition.data.futureConditionField).toEqual({ preserved: true });
  expect(loop.data.futureLoopField).toEqual({ preserved: true });
  expect(loop.data.loopFor).toEqual({
    type: 'ref',
    content: ['start_0', 'items'],
    extra: { index: 3 },
  });
  expect(loop.blocks.find((node: any) => node.id === 'block_start_0').data).toEqual({
    futureBlockField: { preserved: true },
  });
});
