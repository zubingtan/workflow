export type FinalOutputEntry = {
  node?: { id: string; type: string };
  status?: string;
  output?: { markdown?: unknown; [key: string]: unknown };
};

export function selectFinalOutput(entries: FinalOutputEntry[]): { outputNodeId: string; markdown: string };
