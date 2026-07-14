import { queryDatabaseReadiness } from "../../../../lib/database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await queryDatabaseReadiness();
    return Response.json({ status: "ready", database: "ready" });
  } catch {
    return Response.json(
      { status: "not_ready", database: "unavailable" },
      { status: 503 },
    );
  }
}
