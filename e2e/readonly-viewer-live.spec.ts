import { expect, test } from '@playwright/test';

import {
  buildWorkflowSchema,
  cancelRun,
  configureFakeProvider,
  createAgent,
  createWorkflow,
  getRunStatus,
  getWorkflowSchema,
  submitRun,
} from './helpers';

/**
 * #182 E2E: ReadonlyViewer live-running mode.
 *
 * Acceptance scenario from map #178:
 *   - Create a workflow where node A runs for ~20s (fake-provider timeout mode).
 *   - While the run is in-flight, open History → click 查看详情 on the running
 *     instance.
 *   - ReadonlyViewer opens in live mode, mounts the Editor with
 *     LiveHistoryRuntimeService, and the LLM node's NodeStatusBar renders
 *     "Running" (WorkflowStatus.Processing).
 *
 * Decisions (locked):
 *   - sleepMs = 20000: long enough to reliably open the viewer + assert
 *     Processing before the run terminates, even in the full suite with
 *     serial workers. Cancellation at the end speeds up teardown.
 *   - Assertion: wait for "运行详情" header (proves ReadonlyViewer mounted)
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

const CORRELATION_ID = 'READONLY_LIVE_20S';
const NODE_SLEEP_MS = 20000;

test.describe('ReadonlyViewer live mode', () => {
  test('running workflow → open ReadonlyViewer → node A shows Running', async ({ page }) => {
    // 20s node sleep + assertion waits + cleanup — extend the default 30s timeout.
    test.setTimeout(60_000);

    // Configure fake-provider to sleep 20s for prompts containing the correlationId.
    await configureFakeProvider(CORRELATION_ID, 'timeout', NODE_SLEEP_MS);

    const agentId = await createAgent();
    // Prompt contains the correlationId so fake-provider matches it.
    const schema = buildWorkflowSchema(agentId, `Live viewer test ${CORRELATION_ID}`);
    // Unique name so the row selector doesn't collide with other tests' workflows.
    const uniqueName = `E2E Live Viewer ${Date.now()}`;
    const workflowId = await createWorkflow(uniqueName, schema);
    const freshSchema = await getWorkflowSchema(workflowId);

    // Submit the run — it will sit in "running" for ~20s.
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
    await wfRow.getByRole('button', { name: '历史' }).click();
    await expect(page.getByText('运行历史').first()).toBeVisible({ timeout: 5_000 });

    // --- Click 查看详情 on the (running) row ---
    await page.getByRole('button', { name: '查看详情' }).first().click();

    // --- Assert ReadonlyViewer mounted (header shows runID) ---
    await expect(page.getByText(/运行详情/).first()).toBeVisible({ timeout: 10_000 });

    // --- Assert the Editor canvas mounted in live mode ---
    // The readonly editor mounts the FlowGram canvas. The LLM node's
    // NodeStatusBar subscribes to onNodeReportChange. Once the SSE
    // run_progress event arrives (server polls every 500ms), the
    // LiveHistoryRuntimeService fires the Processing NodeReport and
    // NodeStatusBar renders the "Running" desc text.
    //
    // Wait up to 10s for the "Running" status text to appear in the
    // node status bar. This proves the SSE → LiveHistoryRuntimeService →
    // reportEmitter → NodeStatusBar path works end-to-end.
    await expect(page.getByText('Running').first()).toBeVisible({ timeout: 10_000 });

    // --- Cleanup: cancel the run so it doesn't leak into subsequent tests.
    // The 20s sleep would otherwise block the next test's start.
    await cancelRun(runID);
  });
});
