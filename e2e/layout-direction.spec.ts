import { expect, test } from '@playwright/test';

import { buildWorkflowSchema, createAgent, createWorkflow } from './helpers';

/**
 * #190 E2E: editor canvas layout direction switch.
 *
 * Acceptance: clicking the Layout Direction toggle flips the axis the
 * next Auto Layout reflow uses. The test asserts the axis-of-spread
 * (range of x vs range of y across the three nodes) flips from
 * horizontal-dominant (initial seed) to vertical-dominant after
 * toggle + reflow.
 *
 * FlowGram's free-layout-editor positions each node by setting inline
 * `style.left` / `style.top` (in canvas-space px) on the
 * `.gedit-flow-activity-node[data-node-id="..."]` element. These values
 * are independent of the parent render layer's zoom transform, so they
 * are the correct source of truth for canvas-space coordinates.
 */
const NODE_IDS = ['start_0', 'llm_main', 'end_0'] as const;

type XY = { x: number; y: number };

async function readNodePositions(
  page: import('@playwright/test').Page
): Promise<Record<string, XY>> {
  return page.evaluate(
    (ids) => {
      const out: Record<string, { x: number; y: number }> = {};
      const parsePx = (value: string): number | undefined => {
        if (!value || !value.endsWith('px')) {
          return undefined;
        }
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : undefined;
      };
      for (const id of ids) {
        const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
        if (!el) {
          continue;
        }
        const x = parsePx(el.style.left);
        const y = parsePx(el.style.top);
        if (x === undefined || y === undefined) {
          continue;
        }
        out[id] = { x, y };
      }
      return out;
    },
    [...NODE_IDS]
  );
}

function axisSpread(positions: Record<string, XY>): { xRange: number; yRange: number } {
  const xs = NODE_IDS.map((id) => positions[id]?.x).filter((v): v is number => v !== undefined);
  const ys = NODE_IDS.map((id) => positions[id]?.y).filter((v): v is number => v !== undefined);
  if (xs.length === 0 || ys.length === 0) {
    throw new Error('missing node positions');
  }
  return {
    xRange: Math.max(...xs) - Math.min(...xs),
    yRange: Math.max(...ys) - Math.min(...ys),
  };
}

test.describe('Layout direction switch (#190)', () => {
  test('toggling direction then Auto Layout flips the reflow axis from horizontal to vertical', async ({
    page,
  }) => {
    const agentId = await createAgent();
    const schema = buildWorkflowSchema(agentId, 'Layout direction E2E');
    const wfName = `E2E Layout Direction ${Date.now()}`;
    const workflowId = await createWorkflow(wfName, schema);

    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page.locator('tr', { hasText: wfName }).first();
    await wfRow.getByRole('button', { name: 'Open' }).click();

    // Wait for the editor canvas to mount the three nodes.
    await expect(page.locator('[data-node-id="start_0"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-node-id="end_0"]')).toBeVisible();

    // --- Read initial positions (seeded horizontal: x spread, y clustered) ---
    const before = await readNodePositions(page);
    expect(Object.keys(before).length).toBe(3);
    const beforeSpread = axisSpread(before);

    // Sanity: the seed schema has all three nodes at y:300 with x spread,
    // so the initial layout must be horizontal-dominant. If this fails, the
    // editor has already reflowed or the seed changed.
    expect(beforeSpread.xRange).toBeGreaterThan(beforeSpread.yRange);

    // --- Click the Layout Direction toggle (LR → TB) ---
    await page.getByRole('button', { name: /Layout Direction: Horizontal/ }).click();

    // --- Click Auto Layout to trigger a reflow with the new direction ---
    await page.getByRole('button', { name: 'Auto Layout' }).click();

    // Wait for the 1s reflow animation to settle (plus margin).
    await page.waitForTimeout(1800);

    // --- Read post-reflow positions ---
    const after = await readNodePositions(page);
    expect(Object.keys(after).length).toBe(3);
    const afterSpread = axisSpread(after);

    // The reflow must have materially flipped the dominant axis: the y-range
    // now exceeds the x-range (vertical layout), and the y-range grew
    // relative to before (dagre spreads nodes along the new rank direction).
    expect(afterSpread.yRange).toBeGreaterThan(afterSpread.xRange);
    expect(afterSpread.yRange).toBeGreaterThan(beforeSpread.yRange);
  });
});
