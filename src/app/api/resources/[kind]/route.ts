import { createResource, listResources } from "../../../../lib/resources/repository";
import { WorkflowValidationError } from "../../../../lib/workflows/compiler";

export const dynamic = "force-dynamic";
function validation(error: WorkflowValidationError) { return Response.json({ code: error.code, message: error.message, path: error.path, nodeId: error.nodeId }, { status: 400 }); }
export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) { const { kind } = await context.params; const resources = await listResources(kind); return resources ? Response.json(resources) : Response.json({ code: "not_found", message: "Resource kind not found" }, { status: 404 }); }
export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) { const { kind } = await context.params; try { const resource = await createResource(kind, await request.json()); return resource ? Response.json(resource, { status: 201 }) : Response.json({ code: "not_found", message: "Resource kind not found" }, { status: 404 }); } catch (error) { return error instanceof WorkflowValidationError ? validation(error) : Response.json({ code: "internal_error", message: "The server could not process the request" }, { status: 500 }); } }
