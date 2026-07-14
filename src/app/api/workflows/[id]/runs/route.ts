import { listWorkflowRuns } from "../../../../../lib/runs/repository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await listWorkflowRuns(id);
  if (result === null) {
    return Response.json({ code: "not_found", message: "Workflow not found" }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
