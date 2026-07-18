import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("M1 resource and workflow authoring boundary", () => {
  test("writes the selected immutable agent version into the node and advances dirty workflow agents", async () => {
    const [client, board, repository, runs, worker] = await Promise.all([
      source("src/app/workflows/[id]/workflow-client.tsx"),
      source("src/app/components/workflow-board.tsx"),
      source("src/lib/workflows/repository.ts"),
      source("src/lib/runs/repository.ts"),
      source("scripts/worker.mjs"),
    ]);

    expect(client).toContain("const sources = detail.workflowDefinitionVersion.authoring.agentSources ?? {}");
    expect(client).toContain("const agents = [...dirtyAgents].flatMap");
    expect(client).toContain("nodeId");
    expect(board).toContain("agentVersionRef: resource.latestVersion.id");
    expect(repository).toContain("const agentId = typeof agent.id === \"string\" && agent.id ? agent.id : `agent-${randomUUID()}`");
    expect(repository).toContain("SELECT id FROM agent_definitions WHERE id = ${agentId} FOR UPDATE");
    expect(repository).toContain("node.config.agentVersionRef = version.id");
    expect(repository).toContain("agentVersionRef: version.id");
    expect(runs).toContain("agent_definition_version_id");
    expect(runs).toContain("agentDefinitionVersion");
    expect(worker).toContain("SELECT definition FROM agent_definition_versions WHERE id=${ref}");
    expect(worker).toContain("const snapshot = await agentConfig(node, nodeRun)");
  });

  test("versions every resource update instead of mutating a resource definition in place", async () => {
    const repository = await source("src/lib/resources/repository.ts");

    expect(repository).toContain("SELECT COALESCE(MAX(version), 0)::int AS version");
    expect(repository).toContain("latest.version + 1");
    expect(repository).toContain("INSERT INTO ${target.versions}");
    expect(repository).not.toMatch(/UPDATE \$\{target\.versions\} SET definition/u);
  });
});
