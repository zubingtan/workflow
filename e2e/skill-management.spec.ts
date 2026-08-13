import { expect, test } from '@playwright/test';

test('skill editor uses compact tree icons, themed code, and a compact new-file dialog', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('workflow-theme', 'dark'));
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#/settings');
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'New Skill', exact: true }).click();

  const editorDialog = page.getByRole('dialog').filter({ hasText: 'New Skill' }).first();
  await expect(editorDialog).toBeVisible();
  const treeIcon = editorDialog.locator('[data-skill-file-tree] svg').first();
  const treeIconBox = await treeIcon.boundingBox();
  expect(treeIconBox).not.toBeNull();
  expect(treeIconBox!.width).toBeLessThanOrEqual(16);
  expect(treeIconBox!.height).toBeLessThanOrEqual(16);

  const codeEditor = editorDialog.locator('[data-skill-editor-code] .cm-editor');
  await expect(codeEditor).toBeVisible();
  const codeBackground = await codeEditor.evaluate(
    (element) => getComputedStyle(element).backgroundColor
  );
  expect(codeBackground).not.toMatch(/^rgb\(255,\s*255,\s*255\)$/);

  await editorDialog.getByRole('button', { name: 'New file', exact: true }).click();
  const newFileDialog = page.getByRole('dialog').filter({ hasText: 'New file' }).last();
  await expect(newFileDialog).toBeVisible();
  const newFileBox = await newFileDialog.boundingBox();
  expect(newFileBox).not.toBeNull();
  expect(newFileBox!.width).toBeLessThanOrEqual(448);
});
