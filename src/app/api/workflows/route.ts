import { createWorkflow, isWorkflowNameConflict, listWorkflowDefinitions } from "../../../lib/workflows/repository";
import { WorkflowValidationError } from "../../../lib/workflows/compiler";

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  return Response.json(await listWorkflowDefinitions());
}

export async function POST(request: Request) {
  try {
    const value = request.headers.get("content-length") === "0" ? undefined : await request.json().catch(() => undefined);
    return Response.json(await createWorkflow(value), { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowValidationError) return Response.json({ code: error.code, message: error.message, path: error.path, nodeId: error.nodeId }, { status: 400 });
    if (isWorkflowNameConflict(error)) return Response.json({ code: "workflow_name_conflict", message: "A workflow with this name already exists" }, { status: 409 });
    return Response.json({ code: "internal_error", message: "The server could not process the request" }, { status: 500 });
  }
}
