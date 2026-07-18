import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function packageScripts() {
  const packageJson = JSON.parse(await source("package.json")) as {
    scripts: Record<string, string>;
  };
  return packageJson.scripts;
}

async function commandSource(command: string) {
  const localScript = /(?:^|\s)(scripts\/[\w./-]+\.(?:mjs|cjs|js))/u.exec(command)?.[1];
  return [command, ...(localScript ? [await source(localScript)] : [])].join("\n");
}

describe("local startup contract", () => {
  test("exposes one canonical setup and lifecycle command set", async () => {
    const scripts = await packageScripts();

    for (const name of ["doctor", "setup", "dev", "dev:build", "dev:real", "down", "logs"]) {
      expect(scripts[name], `missing pnpm ${name}`).toEqual(expect.any(String));
      expect(scripts[name].trim(), `empty pnpm ${name}`).not.toBe("");
    }
    expect(scripts.doctor).toContain("scripts/doctor.mjs");
  });

  test("starts the daily fake stack without rebuilding and waits at most 30 seconds", async () => {
    const scripts = await packageScripts();
    const command = await commandSource(scripts.dev);

    expect(command).toContain("up");
    expect(command).toContain("-d");
    expect(command).toContain("--wait");
    expect(command).toContain("--no-build");
    expect(command).not.toContain("--build");
    expect(command).toMatch(/--wait-timeout[\s,\]"']+(?:[1-9]|[12]\d|30)(?:\D|$)/u);
    expect(command).not.toMatch(/\.env\.local/u);
    expect(command).not.toMatch(/(?<!example)\.env(?![\w.-])/u);
  });

  test("keeps a separate explicit rebuild path and a local-only real-provider path", async () => {
    const scripts = await packageScripts();
    const [buildCommand, realCommand] = await Promise.all([
      commandSource(scripts["dev:build"]),
      commandSource(scripts["dev:real"]),
    ]);

    expect(buildCommand).toContain("--build");
    expect(buildCommand).toContain("--wait");
    expect(realCommand).toContain(".env.local");
  });

  test("does not inject a generic dotenv file into the worker and ships a safe fake default", async () => {
    const [compose, example] = await Promise.all([source("compose.yaml"), source(".env.example")]);
    const worker = /\n  worker:\n([\s\S]*?)(?=\n  postgres:)/u.exec(compose)?.[1];

    expect(worker).toBeDefined();
    expect(worker).not.toMatch(/WORKFLOW_ENV_FILE/u);
    expect(worker).not.toMatch(/(?:^|\n)\s*env_file:\s*[\s\S]*?\.env(?:\s|$)/u);
    expect(example).toContain("PROVIDER_BINDINGS_FILE=config/provider-bindings.fake.json");
    expect(example).toContain("FAKE_PROVIDER_API_KEY=fake-provider-local");
    expect(example).not.toMatch(/WORKFLOW_ENV_FILE/u);
  });

  test("keeps real-provider overrides out of version control", async () => {
    const gitignore = await source(".gitignore");

    expect(gitignore).toMatch(/^\.env\.local$/mu);
    expect(gitignore).toMatch(/^config\/provider-bindings\.local\.json$/mu);
  });

  test("uses one 30-second deadline that aborts the final readiness request", async () => {
    const readySource = await source("scripts/dev-ready.mjs");

    expect(readySource).toContain("export async function waitForReady");
    const moduleUrl = `${pathToFileURL(path.join(root, "scripts/dev-ready.mjs")).href}?contract=${Date.now()}`;
    const { waitForReady } = await import(moduleUrl) as {
      waitForReady: (options: {
        url: string;
        deadlineAt: number;
        now: () => number;
        request: (url: string, options: { signal: AbortSignal }) => Promise<Response>;
        setTimeoutFn: (callback: () => void, milliseconds: number) => unknown;
        clearTimeoutFn: (timer: unknown) => void;
      }) => Promise<void>;
    };

    let now = 23;
    const timeoutDelays: number[] = [];
    let requests = 0;
    const request = (_url: string, options: { signal: AbortSignal }) => {
      requests += 1;
      return new Promise<Response>((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
      });
    };
    const setTimeoutFn = (callback: () => void, milliseconds: number) => {
      timeoutDelays.push(milliseconds);
      queueMicrotask(() => {
        now += milliseconds;
        callback();
      });
      return Symbol("timer");
    };

    await expect(waitForReady({
      url: "http://workflow.test/api/health/ready",
      deadlineAt: 30,
      now: () => now,
      request,
      setTimeoutFn,
      clearTimeoutFn: () => undefined,
    })).rejects.toThrow(/deadline/u);
    expect(timeoutDelays).toEqual([7]);
    expect(requests).toBe(1);
  });
});
