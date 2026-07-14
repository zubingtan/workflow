import { listWorkflowDefinitions } from "../../../lib/workflows/repository";

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  return Response.json(await listWorkflowDefinitions());
}
