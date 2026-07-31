/**
 * UI/UX acceptance script (spec #212) — drives the real UI with Playwright,
 * captures screenshots for visual review, and asserts layout/interaction.
 * Run against the local prod server (http://localhost:4199).
 *
 * NOTE: agent-browser could not auto-launch Chrome in this sandbox (macOS
 * crashpad permission denial), so the project's own Playwright (already used
 * by the E2E suite) drives the browser for acceptance instead.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:4199';
const OUT = '/tmp/mem0-uiux/shots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// --- 1. Settings page: mem0 fields render ---
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.getByText('Settings', { exact: true }).click();
await page.getByRole('heading', { name: 'Global Settings' }).waitFor();
const urlPlaceholder = page.getByPlaceholder('http://localhost:8890');
const keyPlaceholder = page.getByPlaceholder('ADMIN_API_KEY or a user API key');
record('settings: mem0 Server URL field visible', await urlPlaceholder.isVisible());
record('settings: mem0 API Key field visible', await keyPlaceholder.isVisible());
record(
  'settings: mem0 section heading visible',
  await page.getByText('Mem0 Memory Server', { exact: true }).isVisible(),
);
await page.screenshot({ path: `${OUT}/1-settings-mem0-fields.png`, fullPage: true });

// --- 2. Settings: fill + save persists (round-trip through the backend) ---
const host = 'http://localhost:8890';
const key = 'ui-ux-key';
await urlPlaceholder.fill(host);
await keyPlaceholder.fill(key);
await page.getByRole('button', { name: 'Save' }).click();
try {
  await page.getByText('Saved', { exact: true }).waitFor({ timeout: 5000 });
} catch {
  await page.screenshot({ path: `${OUT}/2-debug-save-failed.png`, fullPage: true });
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  console.error('PAGE TEXT AFTER SAVE:', bodyText);
  throw new Error('Saved toast never appeared');
}
const settingsRes = await page.request.get(`${BASE}/api/settings`);
const settings = await settingsRes.json();
record(
  'settings: save persists mem0_host + mem0_api_key',
  settings.mem0_host === host && settings.mem0_api_key === key,
  JSON.stringify({ host: settings.mem0_host, key: settings.mem0_api_key }),
);
await page.screenshot({ path: `${OUT}/2-settings-saved.png`, fullPage: true });

// --- 3. Settings: invalid URL rejected with a Toast ---
await urlPlaceholder.fill('ftp://mem0:8000');
await page.getByRole('button', { name: 'Save' }).click();
const toastVisible = await page
  .getByText('Mem0 server URL must be http(s)', { exact: true })
  .isVisible()
  .catch(() => false);
record('settings: invalid URL shows error Toast', toastVisible);
await page.screenshot({ path: `${OUT}/3-settings-invalid-url.png`, fullPage: true });

// --- 4. Agents page renders (management shell unaffected) ---
await page.getByText('Agents', { exact: true }).click();
await page.getByRole('heading', { name: 'Agents' }).waitFor();
await page.getByRole('button', { name: 'New Agent' }).waitFor();
record('agents: management page renders', true);
await page.screenshot({ path: `${OUT}/4-agents.png`, fullPage: true });

// --- 5. Workflows page renders ---
await page.getByText('Workflows', { exact: true }).click();
await page.getByRole('heading', { name: 'Workflows' }).waitFor();
record('workflows: management page renders', true);
await page.screenshot({ path: `${OUT}/5-workflows.png`, fullPage: true });

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} UI/UX checks passed`);
if (failed.length > 0) process.exit(1);
