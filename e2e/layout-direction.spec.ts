import { expect, test } from '@playwright/test';

import { buildWorkflowSchema, createAgent, createWorkflow } from './helpers';

/**
 * #190 E2E: editor canvas layout direction switch.
 *
 * Acceptance:
 *  - Test 1: clicking the Layout Direction toggle rotates all port anchors
 *    AND reflows the canvas in one atomic action. After toggle: nodes are
 *    stacked vertically (y-spread > x-spread), and connection lines still
 *    exist (proving the port rotation did not break connectivity).
 *  - Test 2: after switching to vertical, a newly-added node's connection
 *    line starts from the node's bottom edge (vertical line) rather than
 *    its right edge — proving the new node's output port is on the bottom
 *    (the ADD_NODE listener in useEditorProps rotated it to match TB).
 *
 * FlowGram's free-layout-editor positions each node by setting inline
 * `style.left` / `style.top` (in canvas-space px) on the
 * `.gedit-flow-activity-node[data-node-id="..."]` element. Connection lines
 * render as `<g class="gedit-flow-activity-edge">` wrappers whose inline
 * style carries `left`/`top`/`width`/`height` of the line bounding box; a
 * vertical line has height > width.
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
  test('toggle rotates ports + reflows canvas + keeps lines connected', async ({ page }) => {
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
    // This performs the full atomic action: rotateAllPorts + autoLayout(TB)
    // + fireRender + context update. No separate Auto Layout click needed.
    await page.getByRole('button', { name: /Layout Direction: Horizontal/ }).click();

    // Wait for the 1s reflow animation to settle (plus margin).
    await page.waitForTimeout(1800);

    // --- Read post-toggle positions ---
    const after = await readNodePositions(page);
    expect(Object.keys(after).length).toBe(3);
    const afterSpread = axisSpread(after);

    // The reflow must have flipped the dominant axis: y-range now exceeds
    // x-range (vertical layout), and the y-range grew relative to before.
    expect(afterSpread.yRange).toBeGreaterThan(afterSpread.xRange);
    expect(afterSpread.yRange).toBeGreaterThan(beforeSpread.yRange);

    // --- Connection lines must still exist after the port rotation ---
    // (proves rotateAllPorts did not break connectivity; fireRender redrew
    // the lines against the new bottom/top anchors).
    const lineCount = await page.locator('.gedit-flow-activity-edge').count();
    expect(lineCount).toBeGreaterThan(0);
  });

  test('newly-added node follows current direction (output port on bottom)', async ({ page }) => {
    // Build a single start-node workflow (no edges yet). The toggle will
    // switch to TB and rotate the start node's output port to the bottom;
    // the ADD_NODE listener will then rotate the new node's input port to
    // the top so the connection line is vertical.
    const startOnlySchema = {
      nodes: [
        {
          id: 'start_0',
          type: 'start',
          meta: { position: { x: 200, y: 200 } },
          data: {
            title: 'Start',
            outputs: {
              type: 'object',
              properties: { query: { type: 'string', default: 'Hello' } },
            },
          },
        },
      ],
      edges: [],
    };
    const wfName = `E2E New Node Direction ${Date.now()}`;
    const workflowId = await createWorkflow(wfName, startOnlySchema);

    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page.locator('tr', { hasText: wfName }).first();
    await wfRow.getByRole('button', { name: 'Open' }).click();

    await expect(page.locator('[data-node-id="start_0"]')).toBeVisible({ timeout: 10_000 });

    // --- Switch to vertical (TB). This rotates the start node's output
    // port to the bottom AND sets the context so new nodes inherit TB. ---
    await page.getByRole('button', { name: /Layout Direction: Horizontal/ }).click();
    await page.waitForTimeout(1800);

    // --- Click the start node's output port to open the node panel ---
    // Ports render with data-testid="sdk.workflow.canvas.node.port" and
    // data-port-entity-type="output". The start node has one output port.
    const startOutputPort = page
      .locator('[data-testid="sdk.workflow.canvas.node.port"][data-port-entity-type="output"]')
      .first();
    await expect(startOutputPort).toBeVisible({ timeout: 5_000 });
    await startOutputPort.click();

    // --- Select "llm" from the node panel ---
    const llmItem = page.locator('[data-testid="demo-free-node-list-llm"]');
    await expect(llmItem).toBeVisible({ timeout: 5_000 });
    await llmItem.click();

    // Wait for the new node + its connection line to render.
    await page.waitForTimeout(800);

    // --- Assert the new connection line is vertical (height > width) ---
    // The line renders as a `.gedit-flow-activity-edge` div wrapping an
    // `<svg>` whose `width`/`height` attributes are the line bounding box
    // (plus PADDING). A vertical line (bottom port → top port) has
    // height > width; a horizontal line (right port → left port) has
    // width > height.
    const lineSvg = page.locator('.gedit-flow-activity-edge svg').first();
    await expect(lineSvg).toBeVisible({ timeout: 5_000 });
    const lineDims = await lineSvg.evaluate((el) => {
      const svg = el as SVGSVGElement;
      return { width: svg.width.baseVal.value, height: svg.height.baseVal.value };
    });
    expect(lineDims.height).toBeGreaterThan(lineDims.width);
  });

  test('condition node dynamic output ports rotate to bottom in TB mode', async ({ page }) => {
    // Build a workflow with a condition node whose branches connect to end
    // nodes. In horizontal mode the condition output ports are on the right
    // (CSS `right: -12px; top: 50%`); after toggling to TB the ConditionPort
    // CSS switches to `bottom: -12px; left: 50%` and `data-port-location`
    // becomes `bottom`, so the connection lines from the condition branches
    // become vertical (height > width).
    const conditionSchema = {
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
          id: 'condition_0',
          type: 'condition',
          meta: { position: { x: 500, y: 300 } },
          data: {
            title: 'Condition',
            conditions: [{ key: 'if_0', value: { type: 'expression', content: 'true' } }],
          },
        },
        {
          id: 'end_0',
          type: 'end',
          meta: { position: { x: 900, y: 200 } },
          data: { title: 'End (if branch)' },
        },
        {
          id: 'end_1',
          type: 'end',
          meta: { position: { x: 900, y: 400 } },
          data: { title: 'End (else branch)' },
        },
      ],
      edges: [
        { sourceNodeID: 'start_0', targetNodeID: 'condition_0' },
        { sourceNodeID: 'condition_0', sourcePortID: 'if_0', targetNodeID: 'end_0' },
        { sourceNodeID: 'condition_0', sourcePortID: 'else', targetNodeID: 'end_1' },
      ],
    };
    const wfName = `E2E Condition Direction ${Date.now()}`;
    const workflowId = await createWorkflow(wfName, conditionSchema);

    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page.locator('tr', { hasText: wfName }).first();
    await wfRow.getByRole('button', { name: 'Open' }).click();

    await expect(page.locator('[data-node-id="condition_0"]')).toBeVisible({ timeout: 10_000 });

    // --- Toggle to vertical (TB) ---
    await page.getByRole('button', { name: /Layout Direction: Horizontal/ }).click();
    await page.waitForTimeout(1800);

    // --- Condition branch output ports must have data-port-location="bottom" ---
    // The ConditionPort DOM elements carry the `data-port-location` attribute
    // set by the renderer based on LayoutDirectionContext. In TB mode it
    // must be "bottom" (rotated from the default "right").
    const portLocations = await page
      .locator('[data-node-id="condition_0"] [data-port-id][data-port-location]')
      .evaluateAll((els) =>
        els.map((el) => ({
          id: el.getAttribute('data-port-id'),
          location: el.getAttribute('data-port-location'),
        }))
      );
    expect(portLocations.length).toBeGreaterThan(0);
    for (const p of portLocations) {
      expect(p.location).toBe('bottom');
    }

    // --- Verify the port DOM elements are actually at the node's bottom edge ---
    // (not just the `data-port-location` attribute, but the real `getBoundingClientRect`
    // position). This catches CSS positioning bugs where `bottom: -12px` resolves
    // against the wrong ancestor (FormItem instead of node).
    const portPositions = await page.evaluate(() => {
      const node = document.querySelector('[data-node-id="condition_0"]') as HTMLElement;
      if (!node) return null;
      const nodeRect = node.getBoundingClientRect();
      const ports = Array.from(node.querySelectorAll('[data-port-id]'));
      return ports
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            id: el.getAttribute('data-port-id'),
            cx: Math.round(r.x + r.width / 2),
            cy: Math.round(r.y + r.height / 2),
          };
        })
        .map((p) => ({
          ...p,
          // Port center Y should be at or below the node's bottom edge (482+12=494).
          // If it's inside the node (cy < nodeBottom), the CSS positioning is wrong.
          nodeBottom: Math.round(nodeRect.bottom),
          isAtBottomEdge: p.cy >= Math.round(nodeRect.bottom) - 5,
        }));
    });
    expect(portPositions).not.toBeNull();
    expect(portPositions!.length).toBeGreaterThan(0);
    for (const p of portPositions!) {
      // Port must be at or below the node's bottom edge (not inside the node).
      expect(p.isAtBottomEdge).toBe(true);
    }

    // --- The connection lines from the condition branches must still exist ---
    // (proves the DOM-driven port rotation didn't break connectivity).
    const edgeCount = await page.locator('.gedit-flow-activity-edge').count();
    expect(edgeCount).toBeGreaterThan(0);
  });

  test('condition node ports round-trip TB → LR restores right-edge placement', async ({
    page,
  }) => {
    // Reuse the same condition workflow shape as Test 3. Toggle LR→TB→LR
    // and assert the ports return to `data-port-location="right"` with DOM
    // positions at the node's right edge.
    const conditionSchema = {
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
          id: 'condition_0',
          type: 'condition',
          meta: { position: { x: 500, y: 300 } },
          data: {
            title: 'Condition',
            conditions: [{ key: 'if_0', value: { type: 'expression', content: 'true' } }],
          },
        },
        {
          id: 'end_0',
          type: 'end',
          meta: { position: { x: 900, y: 200 } },
          data: { title: 'End (if branch)' },
        },
        {
          id: 'end_1',
          type: 'end',
          meta: { position: { x: 900, y: 400 } },
          data: { title: 'End (else branch)' },
        },
      ],
      edges: [
        { sourceNodeID: 'start_0', targetNodeID: 'condition_0' },
        { sourceNodeID: 'condition_0', sourcePortID: 'if_0', targetNodeID: 'end_0' },
        { sourceNodeID: 'condition_0', sourcePortID: 'else', targetNodeID: 'end_1' },
      ],
    };
    const wfName = `E2E Condition RoundTrip ${Date.now()}`;
    await createWorkflow(wfName, conditionSchema);

    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page.locator('tr', { hasText: wfName }).first();
    await wfRow.getByRole('button', { name: 'Open' }).click();

    await expect(page.locator('[data-node-id="condition_0"]')).toBeVisible({ timeout: 10_000 });

    // --- Toggle LR → TB ---
    await page.getByRole('button', { name: /Layout Direction: Horizontal/ }).click();
    await page.waitForTimeout(1800);

    // Verify TB state (ports at bottom).
    const tbLocations = await page
      .locator('[data-node-id="condition_0"] [data-port-id][data-port-location]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-port-location')));
    for (const loc of tbLocations) {
      expect(loc).toBe('bottom');
    }

    // --- Toggle TB → LR (round-trip) ---
    await page.getByRole('button', { name: /Layout Direction: Vertical/ }).click();
    await page.waitForTimeout(1800);

    // Verify LR state: data-port-location="right".
    const lrLocations = await page
      .locator('[data-node-id="condition_0"] [data-port-id][data-port-location]')
      .evaluateAll((els) =>
        els.map((el) => ({
          id: el.getAttribute('data-port-id'),
          location: el.getAttribute('data-port-location'),
        }))
      );
    expect(lrLocations.length).toBeGreaterThan(0);
    for (const p of lrLocations) {
      expect(p.location).toBe('right');
    }

    // --- Verify port DOM is at the node's right edge ---
    const portPositions = await page.evaluate(() => {
      const node = document.querySelector('[data-node-id="condition_0"]') as HTMLElement;
      if (!node) return null;
      const nodeRect = node.getBoundingClientRect();
      const ports = Array.from(node.querySelectorAll('[data-port-id]'));
      return ports.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute('data-port-id'),
          cx: Math.round(r.x + r.width / 2),
          nodeRight: Math.round(nodeRect.right),
          isAtRightEdge: Math.round(r.x + r.width / 2) >= Math.round(nodeRect.right) - 5,
        };
      });
    });
    expect(portPositions).not.toBeNull();
    expect(portPositions!.length).toBeGreaterThan(0);
    for (const p of portPositions!) {
      expect(p.isAtRightEdge).toBe(true);
    }

    // Connection lines must still exist after the round-trip.
    const edgeCount = await page.locator('.gedit-flow-activity-edge').count();
    expect(edgeCount).toBeGreaterThan(0);
  });

  test('multi-condition node dynamic output ports rotate to bottom in TB mode', async ({
    page,
  }) => {
    // Same pattern as the condition test but with a multi-condition node.
    const multiConditionSchema = {
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
                conditions: [
                  { key: 'condition_0', value: { type: 'expression', content: 'true' } },
                ],
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
    const wfName = `E2E MultiCondition Direction ${Date.now()}`;
    await createWorkflow(wfName, multiConditionSchema);

    await page.goto('/');
    await page.getByText('Workflows', { exact: true }).first().click();
    const wfRow = page.locator('tr', { hasText: wfName }).first();
    await wfRow.getByRole('button', { name: 'Open' }).click();

    await expect(page.locator('[data-node-id="multi_condition_0"]')).toBeVisible({
      timeout: 10_000,
    });

    // --- Toggle to vertical (TB) ---
    await page.getByRole('button', { name: /Layout Direction: Horizontal/ }).click();
    await page.waitForTimeout(1800);

    // --- Multi-condition branch output ports must have data-port-location="bottom" ---
    const portLocations = await page
      .locator('[data-node-id="multi_condition_0"] [data-port-id][data-port-location]')
      .evaluateAll((els) =>
        els.map((el) => ({
          id: el.getAttribute('data-port-id'),
          location: el.getAttribute('data-port-location'),
        }))
      );
    expect(portLocations.length).toBeGreaterThan(0);
    for (const p of portLocations) {
      expect(p.location).toBe('bottom');
    }

    // --- Verify port DOM elements are at the node's bottom edge ---
    const portPositions = await page.evaluate(() => {
      const node = document.querySelector('[data-node-id="multi_condition_0"]') as HTMLElement;
      if (!node) return null;
      const nodeRect = node.getBoundingClientRect();
      const ports = Array.from(node.querySelectorAll('[data-port-id]'));
      return ports.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.getAttribute('data-port-id'),
          cy: Math.round(r.y + r.height / 2),
          nodeBottom: Math.round(nodeRect.bottom),
          isAtBottomEdge: Math.round(r.y + r.height / 2) >= Math.round(nodeRect.bottom) - 5,
        };
      });
    });
    expect(portPositions).not.toBeNull();
    expect(portPositions!.length).toBeGreaterThan(0);
    for (const p of portPositions!) {
      expect(p.isAtBottomEdge).toBe(true);
    }

    // Connection lines must still exist.
    const edgeCount = await page.locator('.gedit-flow-activity-edge').count();
    expect(edgeCount).toBeGreaterThan(0);
  });
});
