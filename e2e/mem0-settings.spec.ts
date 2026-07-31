import { expect, test } from '@playwright/test';

/**
 * mem0 settings E2E suite (#212 D12/D13).
 *
 * Covers the settings UI for the self-hosted mem0 server:
 *   1. The Settings view exposes Mem0 Server URL + API Key fields.
 *   2. Saving persists them via PUT /api/settings (SQLite settings table).
 *   3. GET /api/settings returns them — so the backend can write the
 *      per-run extension config ({agentDir}/mem0-config.json).
 *   4. An invalid URL is rejected client-side with a Toast.
 *   5. Empty host is allowed (clears the setting / disables memory).
 *
 * The full memory behavior (auto-capture / recall) is covered by
 * mem0-memory.spec.ts.
 */

const MEM0_HOST = 'http://localhost:8890';
const MEM0_API_KEY = 'e2e-admin-key';

test.describe('Mem0 settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByText('Settings', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Global Settings' })).toBeVisible();
  });

  test('configure mem0 server URL + API key and persist them', async ({ page }) => {
    await page.getByPlaceholder('http://localhost:8890').fill(MEM0_HOST);
    await page.getByPlaceholder('ADMIN_API_KEY or a user API key').fill(MEM0_API_KEY);
    await page.getByRole('button', { name: 'Save' }).click();

    // Toast confirms the save.
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // The backend persisted the settings — GET /api/settings returns them.
    const res = await page.request.get('/api/settings');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.mem0_host).toBe(MEM0_HOST);
    expect(body.mem0_api_key).toBe(MEM0_API_KEY);
  });

  test('rejects a non-http(s) URL with a Toast and does not save', async ({ page }) => {
    await page.getByPlaceholder('http://localhost:8890').fill('ftp://mem0:8000');
    await page.getByPlaceholder('ADMIN_API_KEY or a user API key').fill('k');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Mem0 server URL must be http(s)', { exact: true })).toBeVisible();

    const res = await page.request.get('/api/settings');
    const body = await res.json();
    expect(body.mem0_host).not.toBe('ftp://mem0:8000');
  });

  test('empty host disables memory (clears the setting)', async ({ page }) => {
    // Set a value first.
    await page.getByPlaceholder('http://localhost:8890').fill(MEM0_HOST);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    // Clear it — an empty URL is valid and disables memory.
    await page.getByPlaceholder('http://localhost:8890').fill('');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();

    const res = await page.request.get('/api/settings');
    const body = await res.json();
    expect(body.mem0_host).toBe('');
  });
});
