import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

export type JsonObject = Record<string, any>;

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/valid-workflow.json", import.meta.url), "utf8"),
) as JsonObject;

export function validDefinition(name = `m0-${randomUUID()}`): JsonObject {
  const definition = structuredClone(fixture);
  definition.metadata.name = name;
  return definition;
}

export function mutate(change: (definition: JsonObject) => void, name?: string) {
  const definition = validDefinition(name);
  change(definition);
  return definition;
}

export function reverseObjectKeys(value: any): any {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)]),
    );
  }
  return value;
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

export function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareUnicodeCodePoints).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const compilerModule = "../../src/lib/workflows/compiler";
export async function canonicalize(value: JsonObject) {
  const { canonicalizeJson } = await import(compilerModule);
  return canonicalizeJson(value);
}

export async function compile(definition: JsonObject) {
  const { compileWorkflowDefinition } = await import(compilerModule);
  return compileWorkflowDefinition(definition, {
    agentVersionExists: async (reference: string) => reference === "seed-agent-v1",
    providerBindingExists: async (alias: string) => alias === "fake-default",
  });
}

export async function validationError(definition: JsonObject) {
  try {
    await compile(definition);
  } catch (error) {
    return error as { code: string; message: string; path: string; nodeId: string | null };
  }
  throw new Error("Expected definition validation to fail");
}

export function connectDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return postgres(process.env.DATABASE_URL, { max: 20 });
}

export async function applyMigrations(sql: ReturnType<typeof postgres>) {
  const directory = path.resolve("migrations");
  const migrations = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await sql.unsafe(await readFile(path.join(directory, migration), "utf8"));
  }
}

export async function importWorkflow(definition: JsonObject | string) {
  const modulePath = "../../src/app/api/workflows/import/route";
  const route = await import(modulePath);
  return route.POST(new Request("http://workflow.test/api/workflows/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof definition === "string" ? definition : JSON.stringify(definition),
  }));
}

export async function listWorkflows() {
  const modulePath = "../../src/app/api/workflows/route";
  const route = await import(modulePath);
  return route.GET(new Request("http://workflow.test/api/workflows"));
}

export async function getWorkflow(id: string) {
  const modulePath = "../../src/app/api/workflows/[id]/route";
  const route = await import(modulePath);
  return route.GET(new Request(`http://workflow.test/api/workflows/${id}`), {
    params: Promise.resolve({ id }),
  });
}
