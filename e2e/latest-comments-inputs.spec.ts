import { expect, test } from '@playwright/test';

import { createWorkflow } from './helpers';

function buildCodeWorkflow() {
  return {
    direction: 'LR',
    nodes: [
      {
        id: 'start_0',
        type: 'start',
        meta: { position: { x: 100, y: 300 } },
        data: {
          title: 'Start',
          outputs: {
            type: 'object',
            properties: { query: { type: 'string', default: 'hello' } },
          },
        },
      },
      {
        id: 'code_0',
        type: 'code',
        meta: { position: { x: 500, y: 300 } },
        data: {
          title: 'aggregator',
          inputsValues: {
            first: { type: 'ref', content: ['start_0', 'query'] },
            second: { type: 'ref', content: ['start_0', 'query'] },
            nested: { child: { type: 'ref', content: ['start_0', 'query'] } },
          },
          inputs: {
            type: 'object',
            properties: {
              first: { type: 'string' },
              second: { type: 'string' },
              nested: {
                type: 'object',
                properties: { child: { type: 'string' } },
              },
            },
          },
          script: {
            language: 'javascript',
            content: 'async function main({ params }) { return params; }',
          },
          outputs: { type: 'object', properties: { result: { type: 'string' } } },
        },
      },
      {
        id: 'end_0',
        type: 'end',
        meta: { position: { x: 900, y: 300 } },
        data: {
          title: 'End',
          inputsValues: { result: { type: 'ref', content: ['code_0', 'result'] } },
          inputs: { type: 'object', properties: { result: { type: 'string' } } },
        },
      },
    ],
    edges: [
      { sourceNodeID: 'start_0', targetNodeID: 'code_0' },
      { sourceNodeID: 'code_0', targetNodeID: 'end_0' },
    ],
  };
}

async function openCodeWorkflow(
  page: import('@playwright/test').Page,
  viewport = { width: 1440, height: 900 }
) {
  await page.setViewportSize(viewport);
  const workflowId = await createWorkflow(
    `Latest comments inputs ${Date.now()}`,
    buildCodeWorkflow()
  );
  await page.goto(`/#/workflows/${workflowId}`);
  await expect(page.locator('[data-node-id="code_0"]')).toBeVisible({ timeout: 10_000 });
  return workflowId;
}

test('code node canvas renders ref inputs as variable chips', async ({ page }) => {
  await openCodeWorkflow(page);
  const display = page
    .locator('[data-node-id="code_0"] [data-editor-control="inputs-display"]')
    .first();
  await expect(display).toBeVisible();
  await expect(display.locator('[data-variable-chip]')).toHaveCount(3);
  await expect(display).not.toContainText('{{start_0.query}}');
});

test('code node sidebar inputs stay within the panel at narrow width', async ({ page }) => {
  await openCodeWorkflow(page, { width: 720, height: 900 });
  await page.locator('[data-node-id="code_0"]').click({ position: { x: 10, y: 10 } });
  const panel = page.locator('[data-node-form-panel="true"]');
  await expect(panel).toBeVisible();
  const controls = panel.locator('[data-editor-control="dynamic-value"]');
  await expect(controls).toHaveCount(3);
  for (const control of await controls.all()) {
    await expect
      .poll(async () => control.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
  }
  const rows = panel.locator('[data-input-group] > .flex.items-center');
  for (const row of await rows.all()) {
    await expect
      .poll(async () => row.evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
  }
});

test('code editor uses the resolved application theme', async ({ page }) => {
  await openCodeWorkflow(page);
  await page.locator('[data-node-id="code_0"]').click({ position: { x: 10, y: 10 } });
  const editor = page.locator('[data-code-editor="true"]');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('data-editor-theme', /^(light|dark)$/);
  await expect(editor.locator('[contenteditable="true"]')).toHaveAttribute(
    'aria-autocomplete',
    'list'
  );
});

test('code editor keeps its horizontal scrollport at the bottom of the code box', async ({
  page,
}) => {
  await openCodeWorkflow(page);
  await page.locator('[data-node-id="code_0"]').click({ position: { x: 10, y: 10 } });
  const editor = page.locator('[data-code-editor="true"]');
  const content = editor.locator('[contenteditable="true"]');
  await content.click();
  await content.press('ControlOrMeta+A');
  await content.type('const result = ' + 'x'.repeat(240));

  const metrics = await editor.evaluate((element) => {
    const root = element.getBoundingClientRect();
    const cmEditor = element.querySelector('.cm-editor')?.getBoundingClientRect();
    const scrollportElement = element.querySelector<HTMLElement>('.cm-scroller');
    const scrollport = scrollportElement?.getBoundingClientRect();
    return {
      rootBottom: root.bottom,
      cmBottom: cmEditor?.bottom ?? 0,
      scrollportBottom: scrollport?.bottom ?? 0,
      hasHorizontalOverflow: Boolean(
        scrollportElement && scrollportElement.scrollWidth > scrollportElement.clientWidth
      ),
      contentScrollWidth: element.querySelector('.cm-content')?.scrollWidth ?? 0,
    };
  });

  expect(metrics.hasHorizontalOverflow).toBe(true);
  expect(metrics.cmBottom).toBeGreaterThanOrEqual(metrics.rootBottom - 2);
  expect(metrics.scrollportBottom).toBeGreaterThanOrEqual(metrics.rootBottom - 2);
});

test('code editor uses the shadcn semantic scrollbar treatment', async ({ page }) => {
  await openCodeWorkflow(page);
  await page.locator('[data-node-id="code_0"]').click({ position: { x: 10, y: 10 } });
  const scrollport = page.locator('[data-code-editor="true"] .cm-scroller');
  await expect(scrollport).toBeVisible();

  const styles = await scrollport.evaluate((element) => {
    const style = getComputedStyle(element);
    const thumb = getComputedStyle(element, '::-webkit-scrollbar-thumb');
    return {
      scrollbarWidth: style.scrollbarWidth,
      scrollbarColor: style.scrollbarColor,
      thumbBackground: thumb.backgroundColor,
      thumbRadius: thumb.borderRadius,
    };
  });

  expect(styles.scrollbarWidth).toBe('thin');
  expect(styles.scrollbarColor).not.toBe('auto');
  expect(styles.thumbBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.thumbRadius).toBe('9999px');
});

test('code editor offers node input completions after params dot', async ({ page }) => {
  await openCodeWorkflow(page);
  await page.locator('[data-node-id="code_0"]').click({ position: { x: 10, y: 10 } });
  const editor = page.locator('[data-code-editor="true"]');
  const content = editor.locator('[contenteditable="true"]');
  await expect(content).toBeVisible();

  await content.click();
  await content.press('ControlOrMeta+A');
  await content.type('async function main({ params }) { return params.');

  await expect(page.getByRole('option', { name: 'first' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('option', { name: 'nested' })).toBeVisible();

  await content.press('ControlOrMeta+A');
  await content.type('Math.');
  await expect(page.getByRole('option', { name: 'abs' })).toBeVisible({ timeout: 10_000 });
});

test('Save returns to an enabled idle state after a real edit', async ({ page }) => {
  await openCodeWorkflow(page);
  const saveButton = page.locator('[data-workflow-save]');
  const directionButton = page.getByRole('button', { name: 'Layout Direction: Horizontal' });
  await directionButton.click();
  await expect(saveButton).toBeEnabled({ timeout: 10_000 });
  await saveButton.click();
  await expect(saveButton).toHaveAttribute('data-save-state', 'saved', { timeout: 10_000 });

  await page.getByRole('button', { name: 'Layout Direction: Vertical' }).click();
  await expect(saveButton).toHaveAttribute('data-save-state', 'idle', { timeout: 10_000 });
  await expect(saveButton).toBeEnabled();
});
