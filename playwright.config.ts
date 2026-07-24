import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the workflow project E2E suite.
 *
 * Global setup spawns the three dev processes (fake-provider, Hono server,
 * rsbuild dev) directly as detached process-group leaders, with an isolated
 * SQLite via WORKFLOW_DATA_DIR. Global teardown kills the groups.
 *
 * See e2e/global-setup.ts / e2e/global-teardown.ts for details.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
