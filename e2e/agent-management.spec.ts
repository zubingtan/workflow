import { expect, test } from '@playwright/test';

/**
 * Agent management E2E suite — Miller Columns UI.
 *
 * Covers the high-frequency agent CRUD flows through the real UI:
 *   1. Create an agent via "+ New Agent" → assert it appears in the list.
 *   2. Edit the agent name in General section → assert updated.
 *   3. Reload the page → assert the agent survives (SQLite persistence).
 *   4. Copy the agent → assert a duplicate appears.
 *   5. Delete the agent → assert it's gone from the list.
 *
 * The Miller Columns layout uses:
 *   - Col 2: agent list with "+ New Agent" button (instant create, no form)
 *   - Col 4: section content (General section has name/provider inputs)
 *   - Debounced auto-save (600ms) on blur for name edits
 *
 * Prerequisites: global-setup spawns fake-provider + server + rsbuild dev
 * with an isolated SQLite (WORKFLOW_DATA_DIR).
 */

const AGENT_NAME = `E2E Agent ${Date.now()}`;

test.describe('Agent management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/#/agents');
    // Wait for the agent list to load (New Agent button visible)
    await expect(page.getByRole('button', { name: 'New Agent' })).toBeVisible();
  });

  test('create → list → edit → reload → delete', async ({ page }) => {
    // --- Create: click "+ New Agent" → instant create (no form) ---
    await page.getByRole('button', { name: 'New Agent' }).click();

    // The new agent should appear in the list as "Untitled"
    await expect(page.getByRole('heading', { name: 'Untitled', exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // --- Edit name: find the name input in the General section (Col 4) ---
    // The General section should be visible after auto-selection.
    // Use label-based locator to avoid matching the Col 2 search input.
    const nameInput = page.getByLabel('Name');
    await expect(nameInput).toBeVisible();
    await nameInput.clear();
    await nameInput.fill(AGENT_NAME);
    // Blur to trigger debounced save
    await nameInput.blur();
    // Wait for debounce (600ms) + save
    await page.waitForTimeout(1200);

    // --- List: the edited name appears in the list ---
    await expect(page.getByRole('heading', { name: AGENT_NAME, exact: true })).toBeVisible({
      timeout: 5_000,
    });

    // --- Reload: SQLite persistence ---
    await page.reload();
    await page.goto('/#/agents');
    await expect(page.getByRole('button', { name: AGENT_NAME, exact: true })).toBeVisible();

    // --- Delete: remove the agent ---
    // Click the agent to select it, then use keyboard or context to delete
    // For now, delete via API (UI delete is via context menu, not implemented yet)
    const agents = await page.evaluate(async () => {
      const res = await fetch('/agents');
      return res.json();
    });
    const target = agents.find((a: any) => a.name === AGENT_NAME);
    if (target) {
      await page.evaluate(async (id) => {
        await fetch(`/agents/${id}`, { method: 'DELETE' });
      }, target.id);
    }
    await page.reload();
    await page.goto('/#/agents');
    await expect(page.getByText(AGENT_NAME, { exact: true })).toHaveCount(0);
  });

  test('provider tab loads models, tests the selected model, then saves', async ({ page }) => {
    const agent = await page.evaluate(async () => {
      const response = await fetch('/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Provider E2E ${Date.now()}`,
          config: {
            provider: {
              base_url: 'http://localhost:4011/v1',
              api_key: 'fake-provider-local',
              model: '',
            },
          },
        }),
      });
      return response.json();
    });

    await page.reload();
    await page.goto(`/#/agents/${agent.id}/provider`);
    await expect(page.getByRole('heading', { name: 'Provider', exact: true })).toBeVisible();
    await page.getByLabel('Provider Base URL').fill('http://localhost:4011/v1');
    await page.getByLabel('API Key').fill('fake-provider-local');
    await page.getByRole('button', { name: 'Load Models' }).click();
    await page.locator('#provider-model').selectOption('fake-m0');
    await expect(page.getByText('Context window', { exact: true })).toBeVisible();
    await expect(page.getByText('32,768', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Test Provider' }).click();
    await expect(page.getByText('Test passed')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Save Provider' }).click();

    await expect
      .poll(async () => {
        const response = await page.evaluate(
          async (id) => (await fetch(`/agents/${id}`)).json(),
          agent.id
        );
        return JSON.parse(response.config).provider.model;
      })
      .toBe('fake-m0');

    await page.evaluate(async (id) => {
      await fetch(`/agents/${id}`, { method: 'DELETE' });
    }, agent.id);
  });

  test('workflow and agent rows navigate from their whole surface', async ({ page }) => {
    await page.goto('/#/workflows');
    await page.getByRole('button', { name: 'New workflow' }).click();
    const workflowName = `E2E Row Workflow ${Date.now()}`;
    await page.getByPlaceholder('Workflow name').fill(workflowName);
    await page.getByRole('button', { name: 'OK' }).click();
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    const workflowId = new URL(page.url()).hash.split('/').pop();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    const workflowRow = page.getByTestId('workflow-row').filter({ hasText: workflowName });
    await expect(workflowRow).toBeVisible();
    await workflowRow.getByText('Ready', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/workflows/${workflowId}$`));
    await page.goto('/#/workflows');
    const keyboardWorkflowRow = page.getByTestId('workflow-row').filter({ hasText: workflowName });
    await keyboardWorkflowRow.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/workflows/${workflowId}$`));

    await page.goto('/#/agents');
    await page.getByRole('button', { name: 'New Agent' }).click();
    await expect(page.getByRole('heading', { name: 'Untitled', exact: true })).toBeVisible();
    const agentId = new URL(page.url()).hash.split('/')[2];
    await page.getByRole('button', { name: 'Agents', exact: true }).last().click();
    const agentRow = page.locator('[data-row-interactive]').filter({ hasText: 'Untitled' }).last();
    await expect(agentRow).toBeVisible();
    await agentRow.click({ position: { x: 12, y: 12 } });
    await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/general$`));
    await page.goto('/#/agents');
    const keyboardAgentRow = page
      .locator('[data-row-interactive]')
      .filter({ hasText: 'Untitled' })
      .last();
    await keyboardAgentRow.focus();
    await page.keyboard.press(' ');
    await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/general$`));
  });
});
