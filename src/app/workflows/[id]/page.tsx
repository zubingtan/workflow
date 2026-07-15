import { getWorkflowDefinition } from "../../../lib/workflows/repository";
import { getProviderBindingModel } from "../../../lib/workflows/provider-bindings";
import { WorkflowClient } from "./workflow-client";

export const dynamic = "force-dynamic";

export default async function WorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getWorkflowDefinition(id).catch(() => null);
  const aliases = detail?.workflowDefinitionVersion.definition.spec.nodes.flatMap(
    (node: { config: { providerBindingRef?: string } }) =>
      node.config.providerBindingRef ? [node.config.providerBindingRef] : [],
  ) ?? [];
  const configuredModels: Record<string, string | null> = {};

  try {
    await Promise.all(aliases.map(async (alias: string) => {
      configuredModels[alias] = await getProviderBindingModel(alias);
    }));
  } catch {
    for (const alias of aliases) configuredModels[alias] = null;
  }

  return <WorkflowClient id={id} configuredModels={configuredModels} />;
}
