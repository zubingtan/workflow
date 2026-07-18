import { createWorkflow, listWorkflowDefinitions } from "../../../lib/workflows/repository";
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
    return Response.json({ code: "internal_error", message: "The server could not process the request" }, { status: 500 });
  }
}
