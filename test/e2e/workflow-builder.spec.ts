import type { Page, TestInfo } from "@playwright/test";
import { expect, test } from "./fixtures/compose-stack";

type Resource = { id: string; name: string; latestVersion: { id: string; version: number } };
type ResourceKind = "agents" | "skills" | "mcps";
type RunDetail = { run: { status: string; output: { markdown?: string } | null; nodes: Array<{ nodeId: string; status: string }> } };

function resourceName(kind: ResourceKind) {
  return kind === "mcps" ? "MCP server" : kind.slice(0, -1).replace(/^./u, (letter) => letter.toUpperCase());
}

async function createResource(page: Page, kind: ResourceKind, name: string, definition: Record<string, unknown>) {
  await page.getByRole("tab", { name: kind === "mcps" ? "MCP servers" : resourceName(kind) + "s" }).click();
  await page.getByRole("button", { name: `Create ${resourceName(kind)}` }).click();
  const dialog = page.getByRole("dialog", { name: `Create ${resourceName(kind)}` });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Definition JSON").fill(JSON.stringify(definition));
  const saved = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith(`/api/resources/${kind}`));
  await dialog.getByRole("button", { name: "Save version" }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
}

async function resources(page: Page, appUrl: string, kind: ResourceKind) {
  const response = await page.request.get(`${appUrl}/api/resources/${kind}`);
  expect(response.ok()).toBe(true);
  return (await response.json() as { resources: Resource[] }).resources;
}

function workflowDefinition(name: string, values: Record<string, Resource[]>) {
  const resource = (kind: ResourceKind, resourceName: string) => {
    const item = values[kind].find((candidate) => candidate.name === resourceName);
    if (!item) throw new Error(`Missing ${kind} resource ${resourceName}`);
    return item;
  };
  const skillA = resource("skills", "Skill A"); const skillB = resource("skills", "Skill B");
  const mcpA = resource("mcps", "MCP A"); const mcpB = resource("mcps", "MCP B");
  const agentA = resource("agents", "Agent A"); const agentB = resource("agents", "Agent B");
  return {
    definition: {
      apiVersion: "workflow/v1alpha1",
      kind: "Workflow",
      metadata: { name },
      spec: {
        nodes: [
          { id: "prompt", type: "input.prompt", config: {} },
          { id: "route", type: "logic.condition", config: { branches: [
            { id: "if-a", condition: { type: "group", group: "and", children: [
              { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "A" } },
              { type: "group", group: "or", children: [
                { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "route" } },
                { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "alpha" } },
              ] },
            ] } },
            { id: "else-if-b", condition: { left: { ref: "input.prompt" }, operator: "contains", right: { literal: "B" } } },
            { id: "else" },
          ] } },
          { id: "agent-a", type: "task.agent", config: { systemPrompt: "Use Skill A.", skillVersionRefs: [skillA.latestVersion.id], mcpServerVersionRefs: [mcpA.latestVersion.id], providerBindingRef: "fake-default", agentVersionRef: agentA.latestVersion.id } },
          { id: "agent-b", type: "task.agent", config: { systemPrompt: "Use Skill B.", skillVersionRefs: [skillB.latestVersion.id], mcpServerVersionRefs: [mcpB.latestVersion.id], providerBindingRef: "fake-default", agentVersionRef: agentB.latestVersion.id } },
          { id: "result", type: "output.markdown", config: {} },
        ],
        edges: [
          { from: "prompt", to: "route", mapping: [{ source: "prompt", target: "prompt" }] },
          { from: "route", sourcePort: "if-a", to: "agent-a", mapping: [{ source: "input.prompt", target: "prompt" }] },
          { from: "route", sourcePort: "else-if-b", to: "agent-b", mapping: [{ source: "input.prompt", target: "prompt" }] },
          { from: "agent-a", to: "result", mapping: [{ source: "output", target: "output" }] },
          { from: "agent-b", to: "result", mapping: [{ source: "output", target: "output" }] },
        ],
      },
    },
    authoring: { agentSources: { "agent-a": { id: agentA.id, name: agentA.name, definition: { systemPrompt: "A" } }, "agent-b": { id: agentB.id, name: agentB.name, definition: { systemPrompt: "B" } } } },
  };
}

async function waitForRun(page: Page, appUrl: string, runId: string, expected: Record<string, string>) {
  let output: string | null = null;
  await expect.poll(async () => {
    const response = await page.request.get(`${appUrl}/api/runs/${runId}`);
    if (!response.ok()) return { status: String(response.status()), nodes: {} };
    const body = await response.json() as RunDetail;
    output = body.run.output?.markdown ?? null;
    return { status: body.run.status, nodes: Object.fromEntries(body.run.nodes.map((node) => [node.nodeId, node.status])) };
  }, { timeout: 20_000 }).toEqual({ status: "succeeded", nodes: expected });
  return output;
}

async function testRun(page: Page, prompt: string) {
  await page.getByRole("button", { name: "▶ Test run" }).click();
  const dialog = page.getByRole("dialog", { name: "Run workflow" });
  await dialog.getByLabel("Prompt").fill(prompt);
  const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/runs"));
  await dialog.getByRole("button", { name: "Run", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(202);
  return (await response.json() as { runId: string }).runId;
}

test("authors versioned resources and a conditional workflow on the real Compose stack", async ({ page, stack, evidence }, testInfo: TestInfo) => {
  const suffix = `${testInfo.workerIndex}-${Date.now()}`;
  const originalName = `Conditional workflow ${suffix}`;
  const renamedName = `${originalName} renamed`;
  await page.setViewportSize({ width: 2048, height: 1167 });
  await page.goto(`${stack.appUrl}/resources`);
  await expect(page.getByRole("heading", { name: "Resources", level: 1 })).toBeVisible();

  for (const [kind, entries] of Object.entries({
    skills: [["Skill A", { prompt: "Use A guidance." }], ["Skill B", { prompt: "Use B guidance." }]],
    mcps: [["MCP A", { endpoint: "https://mcp-a.test" }], ["MCP B", { endpoint: "https://mcp-b.test" }]],
    agents: [["Agent A", { systemPrompt: "Agent A." }], ["Agent B", { systemPrompt: "Agent B." }]],
  }) as Array<[ResourceKind, Array<[string, Record<string, unknown>]>]>) {
    for (const [name, definition] of entries) await createResource(page, kind, name, definition);
  }

  const values = {
    skills: await resources(page, stack.appUrl, "skills"),
    mcps: await resources(page, stack.appUrl, "mcps"),
    agents: await resources(page, stack.appUrl, "agents"),
  };
  expect(Object.values(values).every((items) => items.length === 2)).toBe(true);

  const created = await page.request.post(`${stack.appUrl}/api/workflows`, { data: { name: originalName } });
  expect(created.status()).toBe(201);
  const workflow = await created.json() as { workflow: { id: string } };
  const update = await page.request.put(`${stack.appUrl}/api/workflows/${workflow.workflow.id}`, { data: workflowDefinition(originalName, values) });
  expect(update.status()).toBe(200);

  const workflowUrl = `${stack.appUrl}/workflows/${workflow.workflow.id}`;
  await page.goto(workflowUrl);
  await expect(page.getByLabel("Workflow name")).toHaveValue(originalName);
  const condition = page.getByRole("button", { name: "Condition node route" });
  await condition.click();
  await expect(page.getByRole("heading", { name: "Condition", level: 2 })).toBeVisible();
  await expect(page.getByText("If", { exact: true })).toBeVisible();
  await expect(page.getByText("Else if", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Inspector").getByText("Else", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Group")).toHaveCount(2);
  await expect(page.getByLabel("Group").nth(0)).toHaveValue("and");
  await expect(page.getByLabel("Group").nth(1)).toHaveValue("or");
  await page.screenshot({ path: testInfo.outputPath("condition-selected.png"), fullPage: false });

  await page.getByRole("button", { name: "Agent node agent-a" }).click();
  await expect(page.getByRole("checkbox", { name: "Skill A v1" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "MCP A v1" })).toBeChecked();
  await page.getByLabel("Workflow name").fill(renamedName);
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/workflows/${workflow.workflow.id}`));
  await page.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Definition v3", { exact: true })).toBeVisible();
  await condition.click();
  await page.screenshot({ path: testInfo.outputPath("workflow-builder.png"), fullPage: false });

  await page.getByRole("tab", { name: "JSON" }).click();
  const json = page.getByRole("region", { name: "Read-only workflow JSON" });
  await expect(json).toContainText('"logic.condition"');
  await expect(json).toContainText('"group": "and"');
  await expect(json).toContainText('"group": "or"');
  await expect(json).toContainText('"else-if-b"');
  await expect(json).toContainText('"source": "input.prompt"');
  await page.getByRole("tab", { name: "Visual" }).click();

  const runA = await testRun(page, `route A ${suffix}`);
  await stack.startWorker();
  expect(await waitForRun(page, stack.appUrl, runA, { prompt: "succeeded", route: "succeeded", "agent-a": "succeeded", "agent-b": "skipped", result: "succeeded" })).toBe("Agent A output");
  await page.goto(`${stack.appUrl}/runs/${runA}`);
  await expect(page.locator("section.output-panel")).toContainText("Agent A output");
  await expect(page.locator('[data-product-node-id="agent-a"]')).toContainText("Succeeded");
  await expect(page.locator('[data-product-node-id="agent-b"]')).toContainText("Skipped · not selected");
  await page.screenshot({ path: testInfo.outputPath("run-route-a.png"), fullPage: false });

  await page.goto(workflowUrl);
  const runB = await testRun(page, `route B ${suffix}`);
  expect(await waitForRun(page, stack.appUrl, runB, { prompt: "succeeded", route: "succeeded", "agent-a": "skipped", "agent-b": "succeeded", result: "succeeded" })).toBe("Agent B output");
  await page.goto(`${stack.appUrl}/runs/${runB}`);
  await expect(page.locator("section.output-panel")).toContainText("Agent B output");
  await expect(page.locator('[data-product-node-id="agent-a"]')).toContainText("Skipped · not selected");
  await expect(page.locator('[data-product-node-id="agent-b"]')).toContainText("Succeeded");
  await page.screenshot({ path: testInfo.outputPath("run-route-b.png"), fullPage: false });

  const removed = await page.request.delete(`${stack.appUrl}/api/workflows/${workflow.workflow.id}`);
  expect(removed.status()).toBe(204);
  for (const path of [`/api/workflows/${workflow.workflow.id}`, `/api/workflows/${workflow.workflow.id}/runs`, `/api/runs/${runA}`, `/api/runs/${runB}`]) {
    expect((await page.request.get(`${stack.appUrl}${path}`)).status()).toBe(404);
  }
  await evidence.assertClean();
});
