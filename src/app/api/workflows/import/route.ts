import {
  WorkflowValidationError,
} from "../../../../lib/workflows/compiler";
import { importWorkflowDefinition } from "../../../../lib/workflows/repository";

export const dynamic = "force-dynamic";

function validationResponse(error: WorkflowValidationError) {
  return Response.json({
    code: error.code,
    message: error.message,
    path: error.path,
    nodeId: error.nodeId,
  }, { status: 400 });
}

export async function POST(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return validationResponse(new WorkflowValidationError("", null));
  }

  try {
    return Response.json(await importWorkflowDefinition(value), { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowValidationError) return validationResponse(error);
    throw error;
  }
}
