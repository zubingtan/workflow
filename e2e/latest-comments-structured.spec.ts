import { test, expect } from '@playwright/test';

import { buildWorkflowSchema, createWorkflow } from './helpers';

test.describe('latest structured-output and condition comments', () => {
  test('structured output keeps its schema, actions and preview in named sections', async ({
    page,
  }) => {
    const schema = buildWorkflowSchema('fake-agent', 'structured output') as any;
    const llm = schema.nodes.find((node: any) => node.id === 'llm_main');
    llm.data.outputs = {
      type: 'object',
      properties: {
        result: { type: 'string' },
        score: { type: 'number' },
      },
    };
    const workflowId = await createWorkflow(`E2E latest structured ${Date.now()}`, schema);

    await page.goto(`/#/workflows/${workflowId}`);
    await page.locator('[data-node-id="llm_main"]').click({ position: { x: 12, y: 12 } });

    const editor = page.locator('[data-structured-output-editor]:visible').last();
    await expect(editor).toBeVisible();
    await expect(editor).toHaveJSProperty('tagName', 'FIELDSET');
    await expect(editor.locator('legend')).toHaveText('Structured Output Schema');
    await expect(editor.locator('[data-structured-output-fields-section]')).toBeVisible();
    await expect(editor.locator('[data-structured-output-actions]')).toBeVisible();
    await expect(editor.locator('[data-structured-output-preview]')).toBeVisible();
    await expect(editor.locator('[data-structured-output-preview] pre')).toContainText('result');

    const firstFieldName = editor.locator('input[placeholder="field_name"]').first();
    await firstFieldName.fill('');
    await firstFieldName.blur();
    await expect(firstFieldName).toHaveAttribute('aria-invalid', 'true');
    await expect(editor.locator('[data-invalid="true"]').first()).toBeVisible();

    const removeFields = editor.getByRole('button', { name: /Remove field/ });
    await removeFields.first().click();
    await expect(removeFields).toHaveCount(1);
    await expect(removeFields.first()).toBeDisabled();
    await expect(editor.locator('[data-structured-output-min-fields]')).toHaveText(
      'At least one field is required.'
    );

    const fields = editor.locator('[data-structured-output-fields]');
    const addField = editor.locator('[data-structured-output-add-field]');
    await expect(addField).toHaveAttribute('data-slot', 'button');
    const [fieldsBox, addBox] = await Promise.all([fields.boundingBox(), addField.boundingBox()]);
    expect(fieldsBox).not.toBeNull();
    expect(addBox).not.toBeNull();
    expect(addBox!.width).toBeCloseTo(fieldsBox!.width, 0);
  });

  test('condition rows stay in a non-overlapping branch stack', async ({ page }) => {
    const schema = buildWorkflowSchema('fake-agent', 'condition') as any;
    schema.nodes = schema.nodes.filter((node: any) => node.id !== 'llm_main');
    schema.edges = [{ sourceNodeID: 'start_0', targetNodeID: 'end_0' }];
    schema.nodes.splice(1, 0, {
      id: 'condition_latest',
      type: 'condition',
      meta: { position: { x: 540, y: 300 } },
      data: {
        title: 'Condition',
        conditions: [
          { key: 'if_first', value: { type: 'expression', content: '' } },
          { key: 'if_second', value: { type: 'expression', content: '' } },
        ],
      },
    });
    const workflowId = await createWorkflow(`E2E latest condition ${Date.now()}`, schema);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/#/workflows/${workflowId}`);
    const condition = page.locator('[data-node-id="condition_latest"]');
    await expect(condition).toBeVisible();
    const branches = condition.locator('[data-condition-branches]');
    await expect(branches).toBeVisible();
    const rows = branches.locator('[data-editor-control="condition-row"]');
    await expect(rows).toHaveCount(2);

    const metrics = await rows.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      })
    );
    expect(metrics[1].top).toBeGreaterThanOrEqual(metrics[0].bottom);
    expect(metrics.every(({ clientWidth, scrollWidth }) => scrollWidth <= clientWidth + 1)).toBe(
      true
    );
  });
});
