import { deleteWorkflow, getWorkflowDefinition, updateWorkflow } from "../../../../lib/workflows/repository";
import { WorkflowValidationError } from "../../../../lib/workflows/compiler";

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

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const workflow = await updateWorkflow(id, await request.json());
    if (!workflow) return Response.json({ code: "not_found", message: "Workflow not found" }, { status: 404 });
    return Response.json(workflow);
  } catch (error) {
    if (error instanceof WorkflowValidationError) return Response.json({ code: error.code, message: error.message, path: error.path, nodeId: error.nodeId }, { status: 400 });
    return Response.json({ code: "internal_error", message: "The server could not process the request" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!await deleteWorkflow(id)) return Response.json({ code: "not_found", message: "Workflow not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
