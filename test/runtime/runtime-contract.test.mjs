import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const piPackage = "@mariozechner/pi-agent-core";
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);

function importSpecifiers(source) {
  return Array.from(
    source.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g),
    (match) => match[1],
  );
}

async function resolveLocalImport(file, specifier) {
  const base = path.resolve(path.dirname(file), specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch {
      // Try the next supported source extension.
    }
  }
  return null;
}

async function reachableImports(entry) {
  const pending = [entry];
  const visited = new Set();

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const dependency = await resolveLocalImport(file, specifier);
      if (dependency) pending.push(dependency);
    }
  }

  return visited;
}

async function collectSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(file));
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(file);
  }
  return files;
}

test("PR4 pins the approved Pi 0.73.1 runtime dependency", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies?.[piPackage], "0.73.1");

  const lockfile = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
  assert.match(lockfile, /@mariozechner\/pi-agent-core:\s*\n\s+specifier: 0\.73\.1\s*\n\s+version: 0\.73\.1/);
});

test("only one dedicated adapter imports Pi and the worker reaches that adapter", async () => {
  const sourceFiles = [
    ...await collectSourceFiles(path.join(root, "src")),
    ...await collectSourceFiles(path.join(root, "scripts")),
  ];
  const sources = new Map(await Promise.all(sourceFiles.map(async (file) => [file, await readFile(file, "utf8")])));
  const piImporters = sourceFiles.filter((file) => importSpecifiers(sources.get(file)).includes(piPackage));

  assert.equal(piImporters.length, 1, `Pi must be imported by exactly one adapter; found: ${piImporters.join(", ")}`);
  const adapter = piImporters[0];

  const worker = path.join(root, "scripts/worker.mjs");
  assert.ok(!importSpecifiers(await readFile(worker, "utf8")).includes(piPackage), "the worker must not import Pi directly");
  assert.ok((await reachableImports(worker)).has(adapter), "scripts/worker.mjs must import the dedicated Pi adapter");
});

test("the Next application reaches neither Pi nor the worker adapter and exposes no Pi Session fields", async () => {
  const allSourceFiles = [
    ...await collectSourceFiles(path.join(root, "src")),
    ...await collectSourceFiles(path.join(root, "scripts")),
  ];
  const piImporters = [];
  for (const file of allSourceFiles) {
    const source = await readFile(file, "utf8");
    if (importSpecifiers(source).includes(piPackage)) piImporters.push(file);
  }
  assert.equal(piImporters.length, 1, "a single Pi adapter is required before checking the app boundary");
  const adapter = piImporters[0];

  const appRoot = path.join(root, "src/app");
  const appFiles = await collectSourceFiles(appRoot);
  for (const file of appFiles) {
    const graph = await reachableImports(file);
    assert.ok(!graph.has(adapter), `${path.relative(root, file)} must not reach the worker Pi adapter`);
    const source = await readFile(file, "utf8");
    assert.ok(!importSpecifiers(source).includes(piPackage), `${path.relative(root, file)} must not import Pi`);
  }

  const appSource = (await Promise.all(appFiles.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(appSource, /PiSession|SessionManager|sessionId|session_id/);
});
