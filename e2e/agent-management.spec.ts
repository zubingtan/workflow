import { expect, test } from '@playwright/test';

/**
 * Agent management E2E suite.
 *
 * Covers the high-frequency, non-trivial agent CRUD flows through the real UI:
 *   1. Create an agent via the New Agent form → assert it appears in the list.
 *   2. Edit the agent → assert the updated name appears, old name is gone.
 *   3. Reload the page → assert the agent survives (SQLite persistence, not
 *      just in-memory state).
 *   4. Copy the agent → assert a duplicate appears.
 *   5. Delete the agent → assert it's gone from the list.
 *
 * Selector strategy: Semi Form.Input renders <input id={field}> with the
 * label text as accessible name, so getByRole('textbox', { name: 'Label*' })
 * works reliably (verified via playwright-cli exploration). Semi Form's
 * onValueChange (fixed from a buggy onChange in this same PR) propagates
 * field values to React state, so fill() triggers the onChange correctly.
 *
 * Prerequisites: global-setup spawns fake-provider + server + rsbuild dev
 * with an isolated SQLite (WORKFLOW_DATA_DIR). The server env has
 * FAKE_PROVIDER_API_KEY set so agent execution would work (though these
 * scenarios don't exercise execution — that's a separate suite).
 */

const FAKE_AGENT = {
  name: `E2E Agent ${Date.now()}`,
  model: 'fake-m0',
  baseUrl: 'http://localhost:4011/v1',
  apiKey: 'fake-provider-local',
  systemPrompt: 'You are an E2E test agent.',
  temperature: '0.5',
};

test.describe('Agent management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigate to the Agents view via the left sidebar.
    await page.getByText('Agents', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
  });

  test('create → list → edit → reload → copy → delete', async ({ page }) => {
    // --- Create ---
    await page.getByRole('button', { name: 'New Agent' }).click();
    await expect(page.getByRole('heading', { name: 'New Agent' })).toBeVisible();

    // Fill the form. Semi Form.Input's `field` prop becomes the <input id> and
    // the `label` prop becomes the accessible name (via <label for>).
    await page.getByRole('textbox', { name: 'Name*' }).fill(FAKE_AGENT.name);
    await page.getByRole('textbox', { name: 'Model*' }).fill(FAKE_AGENT.model);
    await page.getByRole('textbox', { name: 'Provider Base URL*' }).fill(FAKE_AGENT.baseUrl);
    // The API Key field is a Semi AutoComplete; its textbox is still
    // reachable via the label.
    await page.getByRole('textbox', { name: 'API Key*' }).fill(FAKE_AGENT.apiKey);
    await page.getByRole('textbox', { name: 'System Prompt' }).fill(FAKE_AGENT.systemPrompt);

    await page.getByRole('button', { name: 'Create' }).click();

    // --- List: the new agent appears ---
    await expect(page.getByText(FAKE_AGENT.name, { exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // --- Edit: reopen, change name, save ---
    const agentRow = page.locator('tr', { hasText: FAKE_AGENT.name }).first();
    await agentRow.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit Agent' })).toBeVisible();

    // Assert the form populated correctly (read-path round-trip).
    await expect(page.getByRole('textbox', { name: 'Name*' })).toHaveValue(FAKE_AGENT.name);
    await expect(page.getByRole('textbox', { name: 'Model*' })).toHaveValue(FAKE_AGENT.model);

    // Change the name and save.
    const editedName = `${FAKE_AGENT.name} (edited)`;
    await page.getByRole('textbox', { name: 'Name*' }).fill(editedName);
    await page.getByRole('button', { name: 'Save' }).click();

    // The list should now show the edited name, not the original.
    await expect(page.getByText(editedName, { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText(FAKE_AGENT.name, { exact: true })).toHaveCount(0);

    // --- Reload: SQLite persistence (not just in-memory) ---
    await page.reload();
    await page.getByText('Agents', { exact: true }).click();
    await expect(page.getByText(editedName, { exact: true })).toBeVisible();

    // --- Copy: duplicate the agent ---
    const editedRow = page.locator('tr', { hasText: editedName }).first();
    await editedRow.getByRole('button', { name: 'Copy' }).click();
    // Copy creates a duplicate with a suffix; both should now be visible.
    // The copy's name is typically "<original> copy" or similar — assert at
    // least 2 rows now contain the edited name stem.
    await expect(page.locator('tr', { hasText: editedName })).toHaveCount(2, {
      timeout: 5_000,
    });

    // --- Delete: remove both copies ---
    // Delete the copy first (the second row), then the original. Semi uses a
    // Popconfirm for delete — click Delete to open the confirm, then confirm.
    // Semi Popconfirm's confirm button text is "OK" (en_US locale is set app-wide
    // via LocaleProvider in src/app.tsx).
    const rows = page.locator('tr', { hasText: editedName });
    // Delete the second row (the copy).
    await rows.nth(1).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('tr', { hasText: editedName })).toHaveCount(1, {
      timeout: 5_000,
    });
    // Delete the original.
    await page
      .locator('tr', { hasText: editedName })
      .first()
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByText(editedName, { exact: true })).toHaveCount(0, {
      timeout: 5_000,
    });
  });
});
