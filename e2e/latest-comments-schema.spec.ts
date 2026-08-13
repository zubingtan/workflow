import { expect, test } from '@playwright/test';

import { createWorkflow } from './helpers';

test('code output exposes only output fields and keeps its last field', async ({ page }) => {
  const workflowId = await createWorkflow(`Latest schema layout ${Date.now()}`, {
    direction: 'LR',
    nodes: [
      {
        id: 'code_0',
        type: 'code',
        meta: { position: { x: 300, y: 300 } },
        data: {
          title: 'aggregator',
          inputsValues: {},
          inputs: { type: 'object', properties: {} },
          script: { language: 'javascript', content: 'async function main() { return {}; }' },
          outputs: {
            type: 'object',
            properties: { final_result: { type: 'string' } },
          },
        },
      },
    ],
    edges: [],
  });

  await page.goto(`/#/workflows/${workflowId}`);
  await page.locator('[data-node-id="code_0"]').click({ position: { x: 10, y: 10 } });
  const editor = page.locator('[data-editor-control="schema-editor"]:visible').last();
  await expect(editor).toBeVisible();
  await expect(editor.locator('[data-schema-settings]')).toHaveCount(0);
  await expect(editor.locator('[data-schema-fields-section]')).toBeVisible();
  await expect(editor.locator('[data-schema-fields-section]')).toContainText('Output fields');
  await expect(
    editor.getByRole('textbox', { name: 'Schema field final_result', exact: true })
  ).toHaveValue('final_result');
  await expect(
    editor.getByRole('button', { name: 'Remove schema field final_result' })
  ).toBeDisabled();
  await expect(editor.locator('[data-schema-min-fields]')).toHaveText(
    'At least one output field is required.'
  );
});
