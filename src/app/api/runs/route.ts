import {
  createWorkflowRun,
  RunValidationError,
} from "../../../lib/runs/repository";

export const dynamic = "force-dynamic";

function validationResponse(error: RunValidationError) {
  return Response.json({
    code: error.code,
    message: error.message,
    path: error.path,
    nodeId: null,
  }, { status: 400 });
}

export async function POST(request: Request) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return validationResponse(new RunValidationError(""));
  }

  try {
    const result = await createWorkflowRun(value);
    if (result === null) {
      return Response.json({
        code: "not_found",
        message: "Workflow definition version not found",
      }, { status: 404 });
    }
    return Response.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof RunValidationError) return validationResponse(error);
    return Response.json({
      code: "internal_error",
      message: "The server could not process the request",
    }, { status: 500 });
  }
}
