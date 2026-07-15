import { getWorkflowRun } from "../../../lib/runs/repository";
import { getProviderBindingModel } from "../../../lib/workflows/provider-bindings";
import { RunClient } from "./run-client";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getWorkflowRun(id).catch(() => null);
  const aliases = detail?.run.nodes.flatMap((node) =>
    node.providerBindingRef ? [node.providerBindingRef] : []) ?? [];
  const configuredModels: Record<string, string | null> = {};

  try {
    await Promise.all(aliases.map(async (alias) => {
      configuredModels[alias] = await getProviderBindingModel(alias);
    }));
  } catch {
    for (const alias of aliases) configuredModels[alias] = null;
  }

  return <RunClient id={id} configuredModels={configuredModels} />;
}
