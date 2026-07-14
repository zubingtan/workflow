import { getWorkflowDefinition } from "../../../../lib/workflows/repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const workflow = await getWorkflowDefinition(id);
  if (!workflow) {
    return Response.json({ code: "not_found", message: "Workflow not found" }, { status: 404 });
  }
  return Response.json(workflow);
}
