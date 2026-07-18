import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("M1 workflow runtime boundary", () => {
  test("routes model execution through the Pi adapter and applies only referenced Skill prompt text", async () => {
    const [worker, adapter] = await Promise.all([
      source("scripts/worker.mjs"),
      source("scripts/pi-runtime-adapter.mjs"),
    ]);

    expect(worker).toContain('import { runPiAgent } from "./pi-runtime-adapter.mjs"');
    expect(worker).toMatch(/SELECT definition FROM skill_definition_versions WHERE id=\$\{ref\}/u);
    expect(worker).toMatch(/definition\.prompt \?\? definition\.content/u);
    expect(worker).toContain('systemPrompt: [snapshot.systemPrompt, skills].filter(Boolean).join("\\n\\n")');
    expect(adapter).toContain("const agent = new Agent({");
    expect(adapter).toContain("await agent.prompt(prompt);");
  });

  test("does not execute MCP definitions as Pi tools", async () => {
    const worker = await source("scripts/worker.mjs");
    const taskAgentCall = worker.match(/runPiAgent\(\{[\s\S]*?tools: \[\][\s\S]*?\}\)/u)?.[0];

    expect(taskAgentCall).toBeDefined();
    expect(taskAgentCall).not.toMatch(/mcpServerVersionRefs/u);
    expect(worker).not.toMatch(/SELECT definition FROM mcp_definition_versions/u);
  });

  test("recovers expired leases before claiming the next job in one transaction", async () => {
    const worker = await source("scripts/worker.mjs");

    expect(worker).toMatch(/sql\.begin\(async \(transaction\) => \{ await transaction`UPDATE queue_jobs SET status='available',lease_owner=NULL,lease_expires_at=NULL WHERE status='leased' AND lease_expires_at<=now\(\)`/u);
    expect(worker).toContain("FOR UPDATE SKIP LOCKED");
  });

  test("fences every execution write with the current unexpired lease", async () => {
    const worker = await source("scripts/worker.mjs");

    expect(worker).toMatch(/SELECT id FROM queue_jobs WHERE id=\$\{job\.id\} AND lease_owner=\$\{owner\} AND lease_expires_at>now\(\) FOR UPDATE/u);
    expect(worker.match(/await writeWithLease\(job, async \(transaction\) =>/gu)).toHaveLength(6);
    expect(worker).toContain("if (error instanceof LeaseLostError) return;");
  });
});
