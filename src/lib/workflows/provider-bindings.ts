import { readFile } from "node:fs/promises";

export class ProviderBindingConfigurationError extends Error {
  constructor() {
    super("Provider binding configuration is invalid");
    this.name = "ProviderBindingConfigurationError";
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validParameters(value: unknown) {
  return plainObject(value) && Object.values(value).every((parameter) =>
    typeof parameter === "string"
    || typeof parameter === "number"
    || typeof parameter === "boolean");
}

function validBinding(value: unknown) {
  if (!plainObject(value)) return false;
  const required = ["provider", "baseUrl", "apiKeyEnv", "model"];
  const allowed = new Set([...required, "parameters"]);
  return required.every((field) => typeof value[field] === "string" && value[field].length > 0)
    && Object.keys(value).every((field) => allowed.has(field))
    && (!Object.hasOwn(value, "parameters") || validParameters(value.parameters));
}

export async function providerBindingExists(alias: string) {
  const bindingFile = process.env.PROVIDER_BINDINGS_FILE;
  if (!bindingFile) throw new ProviderBindingConfigurationError();

  try {
    const document = JSON.parse(await readFile(bindingFile, "utf8"));
    if (!plainObject(document)
      || Object.keys(document).length !== 1
      || !plainObject(document.bindings)
      || Object.entries(document.bindings).some(([name, binding]) => name.length === 0 || !validBinding(binding))) {
      throw new ProviderBindingConfigurationError();
    }
    return Object.hasOwn(document.bindings, alias);
  } catch {
    throw new ProviderBindingConfigurationError();
  }
}
