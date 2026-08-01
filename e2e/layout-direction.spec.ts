import { test, expect, Page, Locator } from '@playwright/test';

import { createWorkflow } from './helpers';

/**
 * #190 E2E: layout direction switch with port rotation — full routing coverage.
 *
 * Replaces the previous "too simple" layout-direction spec. The centrepiece is
 * a `start → condition → 6×end` workflow that proves the layout direction
 * switch is behaviour-preserving:
 *
 *  - The start node exposes an integer `query` input.
 *  - The condition node has five branches (`query == 1` … `query == 5`) plus
 *    the implicit `else`, each wired to its own End node.
 *  - Each End node emits a DISTINCT constant (`end_1` … `end_6`), so a Test
 *    Run with input N finishes with workflow output `end_N` (input 6 falls
 *    through to `else` → `end_6`). This relies on the runtime-js patch that
 *    relaxes "only one end node" to "at least one end node".
 *
 * The test walks the canvas through four layout states (LR → TB → LR → TB) and,
 * in EVERY state:
 *   1. asserts the reflow flipped the dominant axis,
 *   2. asserts the condition output ports rotated (TB=bottom / LR=right),
 *   3. asserts all 7 connection lines still render (connectivity preserved),
 *   4. asserts the 6 condition→end lines do NOT cross (port order along the
 *      condition edge maps monotonically onto the target End order),
 *   5. runs Test Run for inputs 1..6 via the UI and asserts output `end_N`.
 *
 * A second, lighter test covers the multi-condition node (reflow + port
 * location + connectivity only — no runtime routing, because the multi-condition
 * executor's branch structure does not line up with the condition executor's).
 *
 * FlowGram positions nodes via inline `style.left`/`style.top` on
 * `[data-node-id]`; connection lines render as `.gedit-flow-activity-edge`;
 * condition output ports carry `data-port-id` + `data-port-location`.
 */

// ---- condition workflow topology -----------------------------------------

const CONDITION_KEYS = ['if_1', 'if_2', 'if_3', 'if_4', 'if_5'] as const;
const END_IDS = ['end_1', 'end_2', 'end_3', 'end_4', 'end_5', 'end_6'] as const;

/** condition output port id → target end node id (the 6 logical branches). */
const PORT_TO_END: Record<string, string> = {
  if_1: 'end_1',
  if_2: 'end_2',
  if_3: 'end_3',
  if_4: 'end_4',
  if_5: 'end_5',
  else: 'end_6',
};

/** input N → expected workflow output constant. */
function expectedOutputFor(input: number): string {
  return input <= 5 ? `end_${input}` : 'end_6';
}

function buildConditionSchema() {
  const conditions = CONDITION_KEYS.map((key, i) => ({
    key,
    value: {
      left: { type: 'ref', content: ['start_0', 'query'] },
      operator: 'eq',
      right: { type: 'constant', content: i + 1 },
    },
  }));

  const endNodes = END_IDS.map((id, i) => ({
    id,
    type: 'end',
    meta: { position: { x: 900, y: 100 + i * 100 } },
    data: {
      title: `End ${i + 1}`,
      inputsValues: { result: { type: 'constant', content: id } },
      inputs: { type: 'object', properties: { result: { type: 'string' } } },
    },
  }));

  return {
    nodes: [
      {
        id: 'start_0',
        type: 'start',
        meta: { position: { x: 100, y: 300 } },
        data: {
          title: 'Start',
          outputs: {
            type: 'object',
            properties: { query: { type: 'integer', default: 1 } },
          },
        },
      },
      {
        id: 'condition_0',
        type: 'condition',
        meta: { position: { x: 500, y: 300 } },
        data: { title: 'Condition', conditions },
      },
      ...endNodes,
    ],
    edges: [
      { sourceNodeID: 'start_0', targetNodeID: 'condition_0' },
      ...Object.entries(PORT_TO_END).map(([sourcePortID, targetNodeID]) => ({
        sourceNodeID: 'condition_0',
        sourcePortID,
        targetNodeID,
      })),
    ],
  };
}

function buildMultiConditionSchema() {
  return {
    nodes: [
      {
        id: 'start_0',
        type: 'start',
        meta: { position: { x: 100, y: 300 } },
        data: {
          title: 'Start',
          outputs: {
            type: 'object',
            properties: { query: { type: 'string', default: 'Hello' } },
          },
        },
      },
      {
        id: 'multi_condition_0',
        type: 'multi-condition',
        meta: { position: { x: 500, y: 300 } },
        data: {
          title: 'Multi Condition',
          branch: [
            {
              logic: 'and',
              conditions: [{ key: 'condition_0', value: { type: 'expression', content: 'true' } }],
            },
          ],
        },
      },
      {
        id: 'end_0',
        type: 'end',
        meta: { position: { x: 900, y: 200 } },
        data: { title: 'End (branch)' },
      },
      {
        id: 'end_1',
        type: 'end',
        meta: { position: { x: 900, y: 400 } },
        data: { title: 'End (else)' },
      },
    ],
    edges: [
      { sourceNodeID: 'start_0', targetNodeID: 'multi_condition_0' },
      { sourceNodeID: 'multi_condition_0', sourcePortID: 'branch.0', targetNodeID: 'end_0' },
      { sourceNodeID: 'multi_condition_0', sourcePortID: 'else', targetNodeID: 'end_1' },
    ],
  };
}

// ---- geometry helpers ----------------------------------------------------

type XY = { x: number; y: number };
type Center = { cx: number; cy: number };
type Direction = 'LR' | 'TB';

async function readNodePositions(page: Page, ids: readonly string[]): Promise<Record<string, XY>> {
  return page.evaluate(
    (nodeIds) => {
      const out: Record<string, { x: number; y: number }> = {};
      const parsePx = (value: string): number | undefined => {
        if (!value || !value.endsWith('px')) return undefined;
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : undefined;
      };
      for (const id of nodeIds) {
        const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
        if (!el) continue;
        const x = parsePx(el.style.left);
        const y = parsePx(el.style.top);
        if (x === undefined || y === undefined) continue;
        out[id] = { x, y };
      }
      return out;
    },
    [...ids]
  );
}

function axisSpread(
  positions: Record<string, XY>,
  ids: readonly string[]
): { xRange: number; yRange: number } {
  const xs = ids.map((id) => positions[id]?.x).filter((v): v is number => v !== undefined);
  const ys = ids.map((id) => positions[id]?.y).filter((v): v is number => v !== undefined);
  if (xs.length === 0 || ys.length === 0) throw new Error('missing node positions');
  return { xRange: Math.max(...xs) - Math.min(...xs), yRange: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Wait until the auto-layout animation settles (explicit wait, not a blind
 * sleep — the reflow animation is ~1s).
 *
 * `siblingIds` are nodes that fan out PERPENDICULAR to the flow direction (the
 * six End nodes share one dagre rank): in TB they spread horizontally
 * (xRange > yRange); in LR they stack vertically (yRange > xRange). Measuring
 * the siblings — not the whole graph — is essential for a 1→1→6 fan-out, whose
 * overall bounding box stays wider than tall even in TB.
 */
async function waitForReflow(page: Page, siblingIds: readonly string[], direction: Direction) {
  await expect
    .poll(
      async () => {
        const positions = await readNodePositions(page, siblingIds);
        const { xRange, yRange } = axisSpread(positions, siblingIds);
        return direction === 'TB' ? xRange > yRange : yRange > xRange;
      },
      { timeout: 10_000, message: `canvas did not reflow to ${direction}` }
    )
    .toBe(true);
}

async function readPortCenters(
  page: Page,
  nodeId: string
): Promise<Array<{ id: string } & Center>> {
  return page.evaluate((nid) => {
    const node = document.querySelector(`[data-node-id="${nid}"]`);
    if (!node) return [];
    return Array.from(node.querySelectorAll('[data-port-id]')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-port-id') as string,
        cx: r.x + r.width / 2,
        cy: r.y + r.height / 2,
      };
    });
  }, nodeId);
}

async function readNodeCenters(
  page: Page,
  ids: readonly string[]
): Promise<Record<string, Center>> {
  return page.evaluate(
    (nodeIds) => {
      const out: Record<string, { cx: number; cy: number }> = {};
      for (const id of nodeIds) {
        const el = document.querySelector(`[data-node-id="${id}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        out[id] = { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
      return out;
    },
    [...ids]
  );
}

/**
 * Non-crossing check: order the condition output ports along the condition's
 * output edge (TB → by x, LR → by y); their target End nodes must appear in the
 * SAME order along that axis (monotonic, no inversion ⇒ no two lines cross).
 * Returns false (not yet) if geometry isn't fully readable.
 */
function isNonCrossing(
  portCenters: Array<{ id: string } & Center>,
  nodeCenters: Record<string, Center>,
  portToEnd: Record<string, string>,
  direction: Direction
): boolean {
  const axis: keyof Center = direction === 'TB' ? 'cx' : 'cy';
  const ports = portCenters.filter((p) => portToEnd[p.id]).sort((a, b) => a[axis] - b[axis]);
  if (ports.length !== 6) return false;
  const targetCoords = ports.map((p) => nodeCenters[portToEnd[p.id]]?.[axis]);
  if (targetCoords.some((c) => c === undefined)) return false;
  for (let i = 1; i < targetCoords.length; i++) {
    if ((targetCoords[i] as number) < (targetCoords[i - 1] as number)) return false;
  }
  return true;
}

/**
 * Poll until the rendered condition→end lines do not cross. The Layout
 * Direction toggle recomputes the condition port slot order AFTER the
 * autoLayout animation settles (fireLayoutSettled), and React re-renders the
 * port anchors a frame or two later; a single geometry read can land between
 * the nodes settling and the port re-render, so we wait for the crossing-free
 * end state instead of asserting on one snapshot.
 */
async function expectNonCrossing(page: Page, direction: Direction) {
  await expect
    .poll(
      async () => {
        const portCenters = await readPortCenters(page, 'condition_0');
        const nodeCenters = await readNodeCenters(page, END_IDS);
        return isNonCrossing(portCenters, nodeCenters, PORT_TO_END, direction);
      },
      { timeout: 10_000, message: `condition→end lines cross (${direction})` }
    )
    .toBe(true);
}

// ---- editor / Test Run UI helpers ----------------------------------------

async function openWorkflowInEditor(page: Page, wfName: string) {
  await page.goto('/');
  await page.getByText('Workflows', { exact: true }).first().click();
  const wfRow = page.locator('tr', { hasText: wfName }).first();
  await wfRow.getByRole('button', { name: 'Open' }).click();
}

async function toggleDirection(page: Page, to: Direction) {
  // The toggle button label reflects the CURRENT direction; clicking switches.
  const label = to === 'TB' ? /Layout Direction: Horizontal/ : /Layout Direction: Vertical/;
  await page.getByRole('button', { name: label }).click();
}

async function openTestRunPanel(page: Page): Promise<Locator> {
  await page.locator('.workflow-tools').getByRole('button', { name: 'Test Run' }).click();
  const panel = page.locator('.gedit-flow-panel-wrap', { hasText: 'Input Form' });
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

/**
 * Drive one UI Test Run: fill the integer `query`, click the panel's run button,
 * and wait for the expected output constant to appear in "Outputs Result".
 * Waiting for the (distinct) expected value doubles as the completion signal —
 * consecutive runs always expect a different value, so a stale result never
 * produces a false pass.
 */
async function runAndWaitOutput(panel: Locator, input: number, expected: string) {
  await panel.getByPlaceholder('Please input integer').fill(String(input));
  // The panel footer run button is the only button in the panel whose name
  // contains "Test Run" (the close button is icon-only). Non-exact match is
  // required: the IconPlay glyph can participate in the accessible name, so an
  // exact match is brittle. It flips to "Cancel" while running.
  await panel.getByRole('button', { name: 'Test Run' }).click();
  await expect(panel.getByText(expected, { exact: true })).toBeVisible({ timeout: 30_000 });
}

// ---- per-state assertions ------------------------------------------------

async function assertConditionCanvasState(page: Page, direction: Direction) {
  // 1. Reflow landed: the six End siblings fan out perpendicular to flow.
  await waitForReflow(page, END_IDS, direction);

  // 2. Condition output ports rotated to the current direction.
  const expectedLocation = direction === 'TB' ? 'bottom' : 'right';
  const portLocations = await page
    .locator('[data-node-id="condition_0"] [data-port-id][data-port-location]')
    .evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-port-id'),
        location: el.getAttribute('data-port-location'),
      }))
    );
  expect(portLocations.length, 'condition output port count').toBe(6);
  for (const p of portLocations) {
    expect(p.location, `port ${p.id} location (${direction})`).toBe(expectedLocation);
  }

  // 3. All 7 connection lines still render (start→condition + 6 branches).
  await expect(page.locator('.gedit-flow-activity-edge')).toHaveCount(7);

  // 4. The 6 condition→end lines do not cross (poll until the settled layout
  //    re-renders the corrected port slot order).
  await expectNonCrossing(page, direction);
}

// ---- tests ---------------------------------------------------------------

test.describe('Layout direction switch (#190)', () => {
  test('condition routing is preserved across LR/TB/LR/TB with non-crossing lines', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const wfName = `E2E Condition Routing ${Date.now()}`;
    await createWorkflow(wfName, buildConditionSchema());
    await openWorkflowInEditor(page, wfName);

    // Wait for the full topology to mount.
    await expect(page.locator('[data-node-id="condition_0"]')).toBeVisible({ timeout: 10_000 });
    for (const id of END_IDS) {
      await expect(page.locator(`[data-node-id="${id}"]`)).toBeVisible();
    }

    const panel = await openTestRunPanel(page);

    // Four layout states: seeded LR, then toggle TB, LR, TB (3 toggles).
    const states: Direction[] = ['LR', 'TB', 'LR', 'TB'];
    for (let s = 0; s < states.length; s++) {
      const direction = states[s];
      if (s > 0) {
        await toggleDirection(page, direction);
      }

      await test.step(`state ${s + 1} (${direction}): canvas + routing`, async () => {
        await assertConditionCanvasState(page, direction);

        for (let input = 1; input <= 6; input++) {
          const expected = expectedOutputFor(input);
          await test.step(`${direction} input ${input} → ${expected}`, async () => {
            await runAndWaitOutput(panel, input, expected);
          });
        }
      });
    }
  });

  test('multi-condition ports rotate + reflow + keep lines (lightweight)', async ({ page }) => {
    const wfName = `E2E MultiCondition Direction ${Date.now()}`;
    await createWorkflow(wfName, buildMultiConditionSchema());
    await openWorkflowInEditor(page, wfName);

    const mcEndIds = ['end_0', 'end_1'];
    await expect(page.locator('[data-node-id="multi_condition_0"]')).toBeVisible({
      timeout: 10_000,
    });

    const assertMcState = async (direction: Direction) => {
      await waitForReflow(page, mcEndIds, direction);

      const expectedLocation = direction === 'TB' ? 'bottom' : 'right';
      const portLocations = await page
        .locator('[data-node-id="multi_condition_0"] [data-port-id][data-port-location]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-port-location')));
      expect(portLocations.length).toBeGreaterThan(0);
      for (const loc of portLocations) {
        expect(loc).toBe(expectedLocation);
      }

      // start→multi-condition + 2 branches = 3 connection lines.
      await expect(page.locator('.gedit-flow-activity-edge')).toHaveCount(3);
    };

    // LR (seeded) → TB → LR round-trip.
    await assertMcState('LR');
    await toggleDirection(page, 'TB');
    await assertMcState('TB');
    await toggleDirection(page, 'LR');
    await assertMcState('LR');
  });
});
