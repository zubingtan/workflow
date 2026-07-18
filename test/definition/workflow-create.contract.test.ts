import { describe, expect, test } from "vitest";
import { createDefaultWorkflow, isWorkflowNameConflict } from "../../src/lib/workflows/repository";

describe("workflow creation", () => {
  test("retries only default-name conflicts with the next deterministic name", async () => {
    const attempted: string[] = [];

    const result = await createDefaultWorkflow(async (name) => {
      attempted.push(name);
      if (name === "Untitled workflow") {
        throw { code: "23505", constraint: "workflows_name_key" };
      }
      return { name };
    });

    expect(attempted).toEqual(["Untitled workflow", "Untitled workflow 2"]);
    expect(result).toEqual({ name: "Untitled workflow 2" });
  });

  test("does not treat unrelated persistence errors as a name conflict", async () => {
    const error = new Error("database unavailable");

    await expect(createDefaultWorkflow(async () => {
      throw error;
    })).rejects.toBe(error);
  });

  test("keeps explicit-name conflicts distinguishable from other unique errors", () => {
    expect(isWorkflowNameConflict({ code: "23505", constraint: "workflows_name_key" })).toBe(true);
    expect(isWorkflowNameConflict({ code: "23505", constraint: "workflow_definition_versions_workflow_id_version_key" })).toBe(false);
  });
});
