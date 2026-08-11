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
 * Phase 10 (#162) E2E: history viewer (Phase 8 readonly editor).
 *
 * Acceptance items covered:
 *   - "View Detail" opens full-screen readonly editor with historical canvas (Phase 8)
 *   - Node detail reuses AgentOutput rendering; non-LLM JSON fallback (Phase 8)
 */

test.describe('History viewer', () => {
  test('submit run → wait terminal → View Detail → readonly editor renders historical canvas', async ({
    page,
  }) => {
    const correlationId = `HISTORY_EXECUTION_DETAIL_${Date.now()}`;
    await configureFakeProvider(
      correlationId,
      'json_response',
      undefined,
      JSON.stringify({ result: 'history detail' })
    );
    const agentId = await createAgent();
    const schema = buildWorkflowSchema(agentId, `Hello history viewer ${correlationId}`);
    const workflowId = await createWorkflow(`E2E Viewer WF ${Date.now()}`, schema);
    const freshSchema = await getWorkflowSchema(workflowId);

    // Submit a run via API (success mode — fake-provider returns immediately).
    const runID = await submitRun(workflowId, freshSchema);

    // Wait for it to reach a terminal state.
    const terminal = await waitForTerminal(runID, 20_000);
    expect(['succeeded', 'failed', 'terminated']).toContain(terminal.status);

    // --- Open History Modal via manager ---
    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page
      .locator('[data-testid="workflow-row"]', { hasText: 'E2E Viewer WF' })
      .first();
    await wfRow.getByRole('button', { name: 'History for E2E Viewer WF' }).click();
    await expect(page.getByText('Run History').first()).toBeVisible({ timeout: 5_000 });

    // --- Click View Detail on the first row ---
    await page.getByRole('button', { name: 'View Detail' }).first().click();

    // --- Assert the history viewer overlay renders ---
    // The overlay shows "Run Detail — <runID>" and a Back button. This proves
    // the HistoryViewer component mounted and fetched the run detail (the
    // title includes the runID from the API response).
    await expect(page.getByText(/Run Detail/).first()).toBeVisible({ timeout: 10_000 });
    // The Back button has an IconArrowLeft img, so its accessible name is
    // "arrow_left Back". Match by text to be icon-name-agnostic.
    await expect(page.getByRole('button', { name: /Back/ })).toBeVisible({ timeout: 5_000 });

    // --- Assert the run detail was fetched (status shown in the header) ---
    // Accept any terminal status — the run already reached terminal in
    // waitForTerminal above; here we just verify the header rendered it.
    await expect(page.getByText(/Status:\s*(succeeded|failed|terminated)/)).toBeVisible({
      timeout: 5_000,
    });

    await page.getByText('Agent_Main', { exact: true }).last().click();
    await expect(page.getByText('Succeed', { exact: true }).nth(1)).toBeVisible();

    // --- Click Back to close the viewer ---
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page.getByText(/Run Detail/)).toHaveCount(0, { timeout: 5_000 });
  });

  test('workflow deletion keeps the open history snapshot readonly', async ({ page }) => {
    const workflowName = `E2E Deleted Viewer WF ${Date.now()}`;
    const agentId = await createAgent();
    const schema = buildWorkflowSchema(agentId, 'Deleted workflow snapshot');
    const workflowId = await createWorkflow(workflowName, schema);
    const runID = await submitRun(workflowId, await getWorkflowSchema(workflowId));
    const terminal = await waitForTerminal(runID, 20_000);
    expect(['succeeded', 'failed', 'terminated']).toContain(terminal.status);

    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const workflowRow = page
      .locator('[data-testid="workflow-row"]', { hasText: workflowName })
      .first();
    await workflowRow.getByRole('button', { name: `History for ${workflowName}` }).click();
    await page.getByRole('button', { name: 'View Detail' }).first().click();
    await expect(page.getByText(/Run Detail/).first()).toBeVisible({ timeout: 10_000 });

    const deleteResponse = await fetch(`http://localhost:4099/workflows/${workflowId}`, {
      method: 'DELETE',
    });
    expect(deleteResponse.status).toBe(200);

    await expect(page.getByText('Workflow 已删除，当前内容为只读快照')).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.locator('[data-testid="workflow-row"]', { hasText: workflowName })
    ).toHaveCount(0, {
      timeout: 5_000,
    });

    await page.getByRole('button', { name: /Back/ }).click();
    await expect(page.getByText('Workflow 已删除。当前运行记录是只读快照。')).toBeVisible({
      timeout: 5_000,
    });
  });
});
