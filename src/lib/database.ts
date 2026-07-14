import postgres from "postgres";

let client: ReturnType<typeof postgres> | undefined;

function database() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  client ??= postgres(databaseUrl, { max: 2 });
  return client;
}

export async function queryDatabaseReadiness() {
  await database()`SELECT 1`;
}
