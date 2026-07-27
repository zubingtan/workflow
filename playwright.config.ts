import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the workflow project E2E suite.
 *
 * After T1-T6 (#116), E2E runs in prod mode: `pnpm build:prod` produces
 * `dist/`, then global-setup spawns fake-provider (4010) + Hono server (4001,
 * NODE_ENV=production) which serves SPA + API + SSE on a single port via T4's
 * serveStatic + SPA fallback. global-teardown kills the groups.
 *
 * Run `pnpm build:prod` before `pnpm test:e2e` — global-setup asserts dist/
 * exists and fails fast with a clear message if not.
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
    baseURL: 'http://localhost:4001',
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
