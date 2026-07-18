export function selectFinalOutput(entries) {
  const succeeded = entries.filter((entry) => entry.node?.type === "output.markdown" && entry.status === "succeeded");
  if (succeeded.length !== 1) throw new Error(`Expected exactly one succeeded Markdown output; found ${succeeded.length}`);
  const [entry] = succeeded;
  if (typeof entry.output?.markdown !== "string") throw new Error("Succeeded Markdown output has no markdown result");
  return { outputNodeId: entry.node.id, markdown: entry.output.markdown };
}
