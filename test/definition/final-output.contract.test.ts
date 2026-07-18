import { describe, expect, test } from "vitest";
import { selectFinalOutput } from "../../src/lib/runs/final-output.mjs";

describe("runtime final Markdown output selection", () => {
  test("returns the actually succeeded Output instead of the first Output in definition order", () => {
    expect(selectFinalOutput([
      { node: { id: "matched", type: "output.markdown" }, status: "skipped", output: undefined },
      { node: { id: "fallback", type: "output.markdown" }, status: "succeeded", output: { markdown: "fallback result" } },
    ])).toEqual({ outputNodeId: "fallback", markdown: "fallback result" });
  });

  test("rejects when no Markdown Output actually succeeded", () => {
    expect(() => selectFinalOutput([
      { node: { id: "matched", type: "output.markdown" }, status: "skipped", output: undefined },
      { node: { id: "agent", type: "task.agent" }, status: "succeeded", output: { output: "not final" } },
    ])).toThrow(/Expected exactly one succeeded Markdown output; found 0/u);
  });

  test("rejects ambiguous runs with multiple succeeded Markdown Outputs", () => {
    expect(() => selectFinalOutput([
      { node: { id: "left", type: "output.markdown" }, status: "succeeded", output: { markdown: "left" } },
      { node: { id: "right", type: "output.markdown" }, status: "succeeded", output: { markdown: "right" } },
    ])).toThrow(/Expected exactly one succeeded Markdown output; found 2/u);
  });
});
