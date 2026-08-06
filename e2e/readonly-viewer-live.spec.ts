import { expect, test } from '@playwright/test';

import {
  buildWorkflowSchema,
  configureFakeProvider,
  createAgent,
  createWorkflow,
  getRunStatus,
  getWorkflowSchema,
  submitRun,
  waitForTerminal,
} from './helpers';

/**
 * #182 E2E: ReadonlyViewer live-running mode.
 *
 * Acceptance scenario from map #178:
 *   - Create a workflow where node A runs for ~10s (fake-provider timeout mode).
 *   - While the run is in-flight, open History → click View Detail on the running
 *     instance.
 *   - ReadonlyViewer opens in live mode, mounts the Editor with
 *     LiveHistoryRuntimeService, and the LLM node's NodeStatusBar renders
 *     "Running" (WorkflowStatus.Processing).
 *
 * Decisions (locked):
 *   - sleepMs = 10000: long enough to open the viewer + assert
 *     Processing before the run terminates, even in the full suite with
 *     serial workers. The delayed response then lets the live viewer remount
 *     into static mode with execution details present.
 *   - Assertion: wait for "Run Detail" header (proves ReadonlyViewer mounted)
 *     then wait for "Running" text (proves SSE run_progress delivered a
 *     Processing NodeReport that LiveHistoryRuntimeService fired into the
 *     NodeStatusBar).
 *
 * #182 connection-exhaustion fix: the ReadonlyViewer no longer opens its own
 * SSE connection. The LiveHistoryRuntimeService (inside the Editor) is the
 * sole SSE subscriber; it forwards `run_terminal` events to the ReadonlyViewer
 * via the `onTerminal` callback. This avoids exceeding Chrome's HTTP/1.1
 * 6-connection-per-origin limit when the manager page already has N SSE
 * subscriptions open (one per workflow via useActiveRunCounts).
 */

const CORRELATION_ID = 'READONLY_LIVE_DELAYED';
const NODE_SLEEP_MS = 10000;

test.describe('ReadonlyViewer live mode', () => {
  test('running workflow → open ReadonlyViewer → node A shows Running', async ({ page }) => {
    // 10s node sleep + assertion waits + cleanup — extend the default 30s timeout.
    test.setTimeout(75_000);

    // Configure fake-provider to sleep 10s for prompts containing the correlationId.
    await configureFakeProvider(
      CORRELATION_ID,
      'timeout',
      NODE_SLEEP_MS,
      JSON.stringify({ result: 'live detail' })
    );

    const agentId = await createAgent();
    // Prompt contains the correlationId so fake-provider matches it.
    const schema = buildWorkflowSchema(agentId, `Live viewer test ${CORRELATION_ID}`);
    // Unique name so the row selector doesn't collide with other tests' workflows.
    const uniqueName = `E2E Live Viewer ${Date.now()}`;
    const workflowId = await createWorkflow(uniqueName, schema);
    const freshSchema = await getWorkflowSchema(workflowId);

    // Submit the run — it will sit in "running" for ~10s.
    const runID = await submitRun(workflowId, freshSchema);

    // Wait specifically for 'running' (not 'queued') so the viewer is opened
    // mid-execution as the spec scenario requires. Polls up to 5s.
    for (let i = 0; i < 50; i++) {
      const s = await getRunStatus(runID);
      if (s === 'running') break;
      if (s === 'succeeded' || s === 'failed' || s === 'terminated') {
        throw new Error(`run ${runID} reached terminal status '${s}' before viewer opened`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(await getRunStatus(runID)).toBe('running');

    // --- Open History Modal via manager ---
    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page.locator('tr', { hasText: uniqueName }).first();
    await wfRow.getByRole('button', { name: 'History' }).click();
    await expect(page.getByText('Run History').first()).toBeVisible({ timeout: 5_000 });

    // --- Click View Detail on the (running) row ---
    await page.getByRole('button', { name: 'View Detail' }).first().click();

    // --- Assert ReadonlyViewer mounted (header shows runID) ---
    await expect(page.getByText(/Run Detail/).first()).toBeVisible({ timeout: 10_000 });

    // --- Assert the Editor canvas mounted in live mode ---
    // The readonly editor mounts the FlowGram canvas. The LLM node's
    // NodeStatusBar subscribes to onNodeReportChange. Once the SSE
    // run_progress event arrives (server polls every 500ms), the
    // LiveHistoryRuntimeService fires the Processing NodeReport and
    // NodeStatusBar renders the "Running" desc text.
    //
    // First select the LLM node in the readonly canvas. The History table also
    // contains a "Running" tag, so asserting that text alone would not prove
    // the live NodeStatusBar mounted.
    const agentNode = page.getByText('Agent_Main', { exact: true }).last();
    await expect(agentNode).toBeVisible({ timeout: 20_000 });
    await agentNode.click();

    // Wait up to 10s for the "Running" status text to appear in the node
    // status bar. This proves the SSE → LiveHistoryRuntimeService →
    // reportEmitter → NodeStatusBar path works end-to-end.
    const runningStatus = page
      .locator('[class*="node-status-header-content"]')
      .filter({ hasText: 'Running' })
      .first();
    await expect(runningStatus).toBeVisible({ timeout: 15_000 });
    await runningStatus.click();

    // Let the delayed provider response complete so the live viewer remounts
    // into static mode and receives a terminal report with execution details.
    const terminal = await waitForTerminal(runID, 40_000);
    expect(terminal.status).toBe('succeeded');

    const terminalAgentNode = page.getByText('Agent_Main', { exact: true }).last();
    await expect(terminalAgentNode).toBeVisible({ timeout: 15_000 });
    await terminalAgentNode.click();
    const terminalStatus = page
      .locator('[class*="node-status-header-content"]')
      .filter({ hasText: /Succeed|Failed|Cancelled|Running/ })
      .nth(1);
    await expect(terminalStatus).toBeVisible({ timeout: 10_000 });
    await terminalStatus.click();
    await expect(page.getByText('Execution Details:', { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
