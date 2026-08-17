import { expect, test } from '@playwright/test';

import { buildWorkflowSchema, configureFakeProvider, createAgent, createWorkflow } from './helpers';

/**
 * T5 browser evidence: the Workflow task/report surface and the Agent SSE
 * surface are exercised independently. The two tests intentionally use
 * separate workflows and fake-provider controls so a terminal event from one
 * controller cannot satisfy the other controller's assertion.
 */
test.describe('T5 runtime interaction smoke', () => {
  test('runs a saved workflow through Test Run and exits terminal loading state', async ({
    page,
  }) => {
    const correlationId = `T5_WORKFLOW_${Date.now()}`;
    await configureFakeProvider(correlationId, 'success');
    const agentId = await createAgent(`T5 workflow ${Date.now()}`);
    const workflowId = await createWorkflow(
      `T5 Workflow Run ${Date.now()}`,
      buildWorkflowSchema(agentId, `workflow ${correlationId}`)
    );

    await page.goto(`/#/workflows/${workflowId}`);
    await expect(page.locator('[data-node-id="llm_main"]')).toBeVisible({ timeout: 10_000 });
    const tools = page.locator('.workflow-tools');
    await tools.getByRole('button', { name: 'Test Run', exact: true }).click();

    const panel = page.locator('.gedit-flow-panel-wrap', { hasText: 'Input Form' });
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const firstRun = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/task/run')
    );
    await panel.getByRole('button', { name: 'Test Run', exact: true }).click();
    await firstRun;

    await expect(panel.locator('[data-testid="testrun-status"]')).toHaveAttribute(
      'data-run-phase',
      'succeeded',
      { timeout: 30_000 }
    );
    // The LLM node's structured output executor projects the deterministic
    // fake-provider response into the declared `{result: string}` field.
    await expect(panel.getByText('ok', { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect(panel.getByRole('button', { name: 'Test Run', exact: true })).toBeEnabled();

    // A terminal run can be retried without cancelling a stale runtime
    // handle; keep the legacy Test Run action name for successful reruns.
    const retryRun = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/task/run')
    );
    await panel.getByRole('button', { name: 'Test Run', exact: true }).click();
    await retryRun;
    await expect(panel.locator('[data-testid="testrun-status"]')).toHaveAttribute(
      'data-run-phase',
      'succeeded',
      { timeout: 30_000 }
    );
  });

  test('streams an LLM response and user cancellation leaves the Agent panel terminal', async ({
    page,
  }) => {
    const successCorrelationId = `T5_LLM_SUCCESS_${Date.now()}`;
    await configureFakeProvider(successCorrelationId, 'success');
    const agentId = await createAgent(`T5 LLM ${Date.now()}`);
    const successWorkflowId = await createWorkflow(
      `T5 LLM Success ${Date.now()}`,
      buildWorkflowSchema(agentId, `prompt ${successCorrelationId}`)
    );

    await page.goto(`/#/workflows/${successWorkflowId}`);
    await page.locator('[data-node-id="llm_main"]').click({ position: { x: 12, y: 12 } });
    const liveSession = page.getByTestId('agent-live-session');
    await expect(liveSession).toBeVisible({ timeout: 10_000 });
    const firstAgentRun = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && /\/agents\/[^/]+\/run$/.test(response.url())
    );
    await liveSession.getByRole('button', { name: 'Run Agent' }).click();
    await firstAgentRun;
    await expect(liveSession.getByTestId('agent-response-content')).toContainText(
      'Fake provider response',
      { timeout: 20_000 }
    );
    await expect(liveSession).toHaveAttribute('data-agent-phase', 'succeeded', {
      timeout: 5_000,
    });
    const retryAgentRun = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && /\/agents\/[^/]+\/run$/.test(response.url())
    );
    await liveSession.getByRole('button', { name: 'Retry' }).click();
    await retryAgentRun;
    await expect(liveSession).toHaveAttribute('data-agent-phase', 'succeeded', {
      timeout: 20_000,
    });

    const cancelCorrelationId = `T5_LLM_CANCEL_${Date.now()}`;
    await configureFakeProvider(cancelCorrelationId, 'timeout', 30_000);
    const cancelWorkflowId = await createWorkflow(
      `T5 LLM Cancel ${Date.now()}`,
      buildWorkflowSchema(agentId, `prompt ${cancelCorrelationId}`)
    );
    await page.goto(`/#/workflows/${cancelWorkflowId}`);
    await page.locator('[data-node-id="llm_main"]').click({ position: { x: 12, y: 12 } });
    const cancelSession = page.getByTestId('agent-live-session');
    await expect(cancelSession).toBeVisible({ timeout: 10_000 });
    await cancelSession.getByRole('button', { name: 'Run Agent' }).click();
    await expect(cancelSession).toHaveAttribute('data-agent-phase', 'streaming', {
      timeout: 5_000,
    });
    await cancelSession.getByRole('button', { name: 'Cancel' }).click();
    await expect(cancelSession).toHaveAttribute('data-agent-phase', 'cancelled', {
      timeout: 5_000,
    });
    await expect(cancelSession.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
