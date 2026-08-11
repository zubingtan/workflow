import { expect, test } from '@playwright/test';

import {
  buildWorkflowSchema,
  cancelRun,
  configureFakeProvider,
  createAgent,
  createWorkflow,
  getRun,
  getWorkflowSchema,
  submitRun,
} from './helpers';

/**
 * Phase 10 (#162) E2E: delete workflow with active runs (Phase 6).
 *
 * Acceptance items covered:
 *   - Delete with active runs → 409 + Delete button disabled (Phase 6)
 *   - Delete workflow cascades workflow_runs (Phase 1 + Phase 6)
 */

test.describe('Delete workflow with active runs', () => {
  test('active run → DELETE 409 + Delete disabled → cancel → DELETE succeeds + cascade', async ({
    page,
  }) => {
    const correlationId = `e2e-delete-${Date.now()}`;
    await configureFakeProvider(correlationId, 'timeout', 15000);

    const agentId = await createAgent();
    const schema = buildWorkflowSchema(agentId, `Run ${correlationId}`);
    const workflowId = await createWorkflow(`E2E Delete WF ${Date.now()}`, schema);
    const freshSchema = await getWorkflowSchema(workflowId);

    // Submit a run (enters queue → running).
    const runID = await submitRun(workflowId, freshSchema);

    // Wait for the run to reach "running" state.
    await expect.poll(async () => (await getRun(runID)).status).toBe('running');

    // --- Attempt DELETE via API → 409 ---
    const deleteRes = await fetch(`http://localhost:4099/workflows/${workflowId}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(409);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.error).toBe('workflow_has_active_runs');

    // --- Navigate to the UI and assert Delete button is disabled ---
    // Load the page AFTER submitting so the SSE subscription catches the
    // run_status event (or the initial list reflects the active run).
    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page
      .locator('[data-testid="workflow-row"]', { hasText: 'E2E Delete WF' })
      .first();
    await expect(wfRow).toBeVisible({ timeout: 5_000 });

    // The Delete button should be disabled. Scope it to the workflow row.
    const deleteBtn = wfRow.getByRole('button', { name: 'Delete E2E Delete WF' });
    // Give the SSE subscription time to receive the init frame + run_status.
    await expect(deleteBtn).toBeDisabled({ timeout: 10_000 });
    // The disabled wrapper carries the reason as a title for keyboard and
    // pointer users without making the disabled button itself hoverable.
    await expect(
      wfRow.getByTitle('This workflow has running or queued runs — cancel them first')
    ).toBeVisible();

    // --- Cancel the run ---
    await cancelRun(runID);

    // Wait for the run to reach terminal state.
    await expect
      .poll(async () => (await getRun(runID)).status, { timeout: 10_000 })
      .toBe('terminated');

    // --- Assert Delete button is now re-enabled ---
    await expect(deleteBtn).toBeEnabled({ timeout: 10_000 });

    // --- Delete the workflow (via API — Popconfirm click is flaky in CI) ---
    const delRes = await fetch(`http://localhost:4099/workflows/${workflowId}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);

    // --- Assert cascade: workflow_runs rows for this workflow are gone ---
    // The endpoint returns an empty array (200) after cascade delete — it
    // doesn't 404 on a missing workflow, it just returns no rows.
    const runsRes = await fetch(`http://localhost:4099/api/workflows/${workflowId}/runs`);
    expect(runsRes.status).toBe(200);
    const runsList = await runsRes.json();
    expect(Array.isArray(runsList)).toBe(true);
    expect(runsList.length).toBe(0);

    // --- Assert the workflow is gone from the UI list ---
    await page.reload();
    await page.getByText('Workflows', { exact: true }).first().click();
    await expect(
      page.locator('[data-testid="workflow-row"]', { hasText: 'E2E Delete WF' })
    ).toHaveCount(0, {
      timeout: 5_000,
    });
  });
});
