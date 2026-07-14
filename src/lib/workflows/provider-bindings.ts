import { readFile } from "node:fs/promises";

export async function providerBindingExists(alias: string) {
  const bindingFile = process.env.PROVIDER_BINDINGS_FILE;
  if (!bindingFile) return false;

  try {
    const document = JSON.parse(await readFile(bindingFile, "utf8"));
    return document !== null
      && typeof document === "object"
      && document.bindings !== null
      && typeof document.bindings === "object"
      && Object.hasOwn(document.bindings, alias);
  } catch {
    return false;
  }
}
