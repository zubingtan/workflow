import { expect, test } from '@playwright/test';

import {
  buildWorkflowSchema,
  configureFakeProvider,
  createAgent,
  createWorkflow,
  getWorkflowSchema,
  submitRun,
  waitForTerminal,
} from './helpers';

/**
 * Phase 10 (#162) E2E: node timeout (Phase 9).
 *
 * Acceptance items covered:
 *   - Node timeout triggers run failed + report.reason='node_timeout' (Phase 9)
 *   - Global timeout default editable in admin UI (Phase 9)
 *   - Per-node override dropdown (1/5/10/30min/no-timeout) (Phase 9)
 */

test.describe('Node timeout', () => {
  test('node timeoutOverride=2000ms + provider sleeps 8s → run failed + report.reason=node_timeout', async () => {
    const correlationId = `e2e-timeout-${Date.now()}`;
    await configureFakeProvider(correlationId, 'timeout', 8000);

    const agentId = await createAgent();
    const schema = buildWorkflowSchema(agentId, `Run ${correlationId}`, 2000);
    const workflowId = await createWorkflow(`E2E Timeout WF ${Date.now()}`, schema);
    const freshSchema = await getWorkflowSchema(workflowId);

    const runID = await submitRun(workflowId, freshSchema);

    // Wait for terminal — should be "failed" (timeout fires at 2s).
    const terminal = await waitForTerminal(runID, 20_000);
    expect(terminal.status).toBe('failed');

    // Assert the report carries a timeout reason. The AgentExecutionError
    // thrown by AgentExecutor has kind:"timeout" + detail.reason:"node_timeout";
    // FlowGram's runtime stores err.message ("node timed out after Nms") in
    // TaskReport.messages.error[0].message, and classifyTerminal propagates
    // that as report.reason. Either form proves the timeout was captured.
    const report =
      typeof terminal.report === 'string' ? JSON.parse(terminal.report) : terminal.report;
    const reportJson = JSON.stringify(report);
    expect(reportJson).toMatch(/node_timeout|node timed out/);
  });

  test('admin settings UI edits the global node_timeout_default_ms', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Settings', { exact: true }).click();
    await expect(page.getByText('Global Settings').first()).toBeVisible({ timeout: 5_000 });

    const beforeRes = await fetch('http://localhost:4099/api/settings');
    const before = await beforeRes.json();

    // Set a new value via the UI. Semi InputNumber renders an <input>.
    const newValue = 123_000;
    const input = page.getByRole('spinbutton').first();
    await input.fill(String(newValue));
    await page.getByRole('button', { name: 'Save' }).click();

    await expect
      .poll(async () => {
        const res = await fetch('http://localhost:4099/api/settings');
        const s = await res.json();
        return s.node_timeout_default_ms;
      })
      .toBe(newValue);

    // Cleanup: restore original (if it was null, leave the test value —
    // it's in the isolated E2E data dir).
    if (before.node_timeout_default_ms != null) {
      await fetch('http://localhost:4099/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_timeout_default_ms: before.node_timeout_default_ms }),
      });
    }
  });

  test('per-node timeout dropdown is present in the LLM node form', async ({ page }) => {
    const agentId = await createAgent();
    const schema = buildWorkflowSchema(agentId, 'Dropdown test');
    const workflowId = await createWorkflow(`E2E Dropdown WF ${Date.now()}`, schema);

    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page.locator('tr', { hasText: 'E2E Dropdown WF' }).first();
    await wfRow.getByRole('button', { name: 'Open' }).click();

    // Wait for editor, then click the LLM node to open its form.
    await expect(page.getByText('Dropdown test').first()).toBeVisible({ timeout: 10_000 });
    await page.getByText('Dropdown test').first().click();

    // The form should show the "Node Timeout" label and the Select dropdown.
    await expect(page.getByText('Node Timeout').first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Use global default').first()).toBeVisible();
  });
});
