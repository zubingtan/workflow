import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const imageTag = "pr6-e2e";
let imageBuild: Promise<void> | undefined;
const redacted = "[REDACTED]";

type ProviderMode = "success" | "auth_failure" | "timeout" | "empty_output";

async function command(file: string, args: string[], env: NodeJS.ProcessEnv) {
  return execFileAsync(file, args, {
    cwd: repositoryRoot,
    env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180_000,
  });
}

async function poll(check: () => Promise<boolean>, message: string, timeout = 90_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(message);
}

function redact(value: string, secret: string) {
  return secret.length === 0 ? value : value.split(secret).join(redacted);
}

export type ComposeStack = {
  appUrl: string;
  secret: string;
  configureProvider(correlationId: string, mode: ProviderMode): Promise<void>;
  logs(): Promise<string>;
  providerCalls(correlationId: string): Promise<number>;
  restartAll(): Promise<void>;
  setAppConfiguredModel(model: string): Promise<void>;
  startWorker(options?: {
    faultHook?: string;
    providerTimeoutMs?: number;
    waitForHealth?: boolean;
  }): Promise<void>;
  stopWorker(): Promise<void>;
  sweepExpiredLeases(): Promise<void>;
  waitForExpiredLease(runId: string): Promise<void>;
  waitForWorkerExit(): Promise<void>;
};

async function createStack(
  testInfo: TestInfo,
  useSecretSentinel: boolean,
): Promise<ComposeStack & { dispose(): Promise<void> }> {
  const hash = createHash("sha256").update(testInfo.testId).digest("hex").slice(0, 8);
  const runNonce = process.env.GITHUB_RUN_ID ?? `${process.pid}-${randomUUID().slice(0, 8)}`;
  const project = `workflow-pr6-${runNonce}-${hash}`.toLowerCase();
  const appPort = 33_000 + (Number.parseInt(hash.slice(0, 4), 16) % 1_000);
  const secret = `${useSecretSentinel ? "PR6_SECRET" : "PR6_FIXTURE"}_${randomUUID()}`;
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "workflow-pr6-"));
  const workerEnvFile = join(fixtureDirectory, "worker.env");
  await writeFile(workerEnvFile, `FAKE_PROVIDER_API_KEY=${secret}\n`);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_PORT: String(appPort),
    FAKE_PROVIDER_API_KEY: secret,
    WORKER_LEASE_MS: "400",
    WORKER_PROVIDER_TIMEOUT_MS: "5000",
    WORKER_FAULT_HOOK: "",
    WORKFLOW_ENV_FILE: workerEnvFile,
    WORKFLOW_IMAGE_TAG: imageTag,
  };
  const base = ["compose", "--project-name", project, "--env-file", ".env.example", "-f", "compose.yaml"];
  const compose = (args: string[]) => command("docker", [...base, ...args], env);

  async function waitHealthy(service: string) {
    await poll(async () => {
      const { stdout } = await compose(["ps", "-q", service]);
      const id = stdout.trim();
      if (!id) return false;
      const inspected = await command("docker", [
        "inspect", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{end}}", id,
      ], env);
      return inspected.stdout.trim() === "healthy";
    }, `${service} did not become healthy`);
  }

  try {
    if (!imageBuild) {
      imageBuild = command("docker", [
        "compose", "--project-name", "workflow-pr6-build", "--env-file", ".env.example",
        "-f", "compose.yaml", "build",
      ], env).then(() => undefined);
    }
    await imageBuild;
    await compose(["up", "-d", "postgres", "fake-provider"]);
    await Promise.all([waitHealthy("postgres"), waitHealthy("fake-provider")]);
    await compose(["run", "--rm", "migrate"]);
    await compose(["up", "-d", "app"]);
    await waitHealthy("app");
  } catch (error) {
    await compose(["down", "--volumes", "--remove-orphans"]).catch(() => undefined);
    await rm(fixtureDirectory, { recursive: true, force: true });
    throw error;
  }

  const stack: ComposeStack & { dispose(): Promise<void> } = {
    appUrl: `http://127.0.0.1:${appPort}`,
    secret,
    async configureProvider(correlationId, mode) {
      await compose([
        "exec", "-T", "-e", `CORRELATION=${correlationId}`, "-e", `MODE=${mode}`,
        "-e", `RAW_DETAIL=${secret}`, "fake-provider", "node", "--input-type=module", "-e",
        `const response=await fetch("http://127.0.0.1:4010/test/control",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({correlationId:process.env.CORRELATION,mode:process.env.MODE,rawDetail:process.env.RAW_DETAIL})});if(!response.ok)process.exit(1);`,
      ]);
    },
    async logs() {
      const result = await compose(["logs", "--no-color", "app", "worker", "fake-provider"]);
      return `${result.stdout}${result.stderr}`;
    },
    async providerCalls(correlationId) {
      const result = await compose([
        "exec", "-T", "-e", `CORRELATION=${correlationId}`, "fake-provider", "node",
        "--input-type=module", "-e",
        `const response=await fetch("http://127.0.0.1:4010/test/stats?correlationId="+encodeURIComponent(process.env.CORRELATION));const body=await response.json();process.stdout.write(String(body.calls));`,
      ]);
      return Number(result.stdout.trim());
    },
    async restartAll() {
      env.WORKER_FAULT_HOOK = "";
      env.WORKER_PROVIDER_TIMEOUT_MS = "5000";
      await compose(["down", "--remove-orphans"]);
      await compose(["up", "-d", "postgres", "fake-provider"]);
      await Promise.all([waitHealthy("postgres"), waitHealthy("fake-provider")]);
      await compose(["run", "--rm", "migrate"]);
      await compose(["up", "-d", "app", "worker"]);
      await Promise.all([waitHealthy("app"), waitHealthy("worker")]);
    },
    async setAppConfiguredModel(model) {
      if (!/^[a-z0-9.-]+$/u.test(model)) throw new Error("Unexpected configured model");
      await compose([
        "exec", "-T", "-e", `MODEL=${model}`, "app", "node", "--input-type=module", "-e",
        `import{readFile,writeFile}from"node:fs/promises";const path=process.env.PROVIDER_BINDINGS_FILE;const value=JSON.parse(await readFile(path,"utf8"));value.bindings["fake-default"].model=process.env.MODEL;await writeFile(path,JSON.stringify(value));`,
      ]);
    },
    async startWorker(options = {}) {
      env.WORKER_FAULT_HOOK = options.faultHook ?? "";
      env.WORKER_PROVIDER_TIMEOUT_MS = String(options.providerTimeoutMs ?? 5_000);
      await compose(["up", "-d", "--force-recreate", "worker"]);
      if (!options.faultHook && options.waitForHealth !== false) await waitHealthy("worker");
    },
    async stopWorker() {
      await compose(["rm", "-sf", "worker"]);
    },
    async sweepExpiredLeases() {
      await compose([
        "run", "--rm", "--no-deps", "-e", "WORKER_FAULT_HOOK=", "worker",
        "node", "scripts/worker.mjs", "--sweep-expired-leases",
      ]);
    },
    async waitForExpiredLease(runId) {
      if (!/^run-[0-9a-f-]+$/u.test(runId)) throw new Error("Unexpected Run ID");
      await poll(async () => {
        const result = await compose([
          "exec", "-T", "postgres", "psql", "-X", "-U", "workflow", "-d", "workflow",
          "-Atc", `SELECT count(*) FROM queue_jobs WHERE workflow_run_id='${runId}' AND status='leased' AND lease_expires_at<=now()`,
        ]);
        return result.stdout.trim() === "1";
      }, "worker lease did not expire", 30_000);
    },
    async waitForWorkerExit() {
      await poll(async () => {
        const { stdout } = await compose(["ps", "-a", "-q", "worker"]);
        const id = stdout.trim();
        if (!id) return false;
        const inspected = await command("docker", ["inspect", "--format", "{{.State.Running}}", id], env);
        return inspected.stdout.trim() === "false";
      }, "fault-injected worker did not exit", 30_000);
    },
    async dispose() {
      try {
        await compose(["down", "--volumes", "--remove-orphans"]);
      } finally {
        await rm(fixtureDirectory, { recursive: true, force: true });
      }
    },
  };
  return stack;
}

type BrowserEvidence = {
  assertClean(): Promise<void>;
  expectHttpError(error: { method: string; path: string; status: number }): void;
};

type Fixtures = {
  evidence: BrowserEvidence;
  stack: ComposeStack;
  useSecretSentinel: boolean;
};

export const test = base.extend<Fixtures>({
  useSecretSentinel: [false, { option: true }],
  stack: async ({ useSecretSentinel }, use, testInfo) => {
    const stack = await createStack(testInfo, useSecretSentinel);
    try {
      await use(stack);
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          const logs = await stack.logs().catch(() => "compose logs unavailable");
          await writeFile(
            testInfo.outputPath("compose.log"),
            redact(logs, stack.secret),
          ).catch(() => undefined);
        }
      } finally {
        await stack.dispose();
      }
    }
  },
  evidence: async ({ page, stack }, use, testInfo) => {
    const consoleLines: string[] = [];
    const consoleErrors: Array<{ kind: "console" | "pageerror"; text: string; url: string }> = [];
    const expectedHttpErrors: Array<{ method: string; path: string; status: number }> = [];
    const network: Array<{ method: string; status: number; url: string; body: string }> = [];
    const pending: Promise<void>[] = [];
    page.on("console", (message) => {
      const url = message.location().url;
      consoleLines.push(`${message.type()}: ${message.text()}${url ? ` [${url}]` : ""}`);
      if (message.type() === "error") {
        consoleErrors.push({ kind: "console", text: message.text(), url });
      }
    });
    page.on("pageerror", (error) => {
      consoleLines.push(`pageerror: ${error.message}`);
      consoleErrors.push({ kind: "pageerror", text: error.message, url: "" });
    });
    page.on("response", (response) => {
      if (!response.url().startsWith(stack.appUrl)) return;
      pending.push((async () => {
        let body = "";
        try { body = await response.text(); } catch { body = "<unavailable>"; }
        network.push({
          method: response.request().method(),
          status: response.status(),
          url: response.url(),
          body,
        });
      })());
    });
    const evidence: BrowserEvidence = {
      async assertClean() {
        await Promise.allSettled(pending);
        const dom = await page.locator("body").innerText().catch(() => "");
        const raw = JSON.stringify({ consoleLines, consoleErrors, network, dom });
        expect(raw.includes(stack.secret), "browser evidence contained the test secret").toBe(false);
        const allowedConsoleErrors = new Set<number>();
        for (const expected of expectedHttpErrors) {
          const responses = network.filter((entry) =>
            entry.method === expected.method &&
            entry.status === expected.status &&
            new URL(entry.url).pathname === expected.path);
          expect(
            responses.length === 1,
            "expected HTTP error was not observed exactly once",
          ).toBe(true);
          if (responses.length !== 1) continue;
          const response = responses[0];
          const matchingConsoleErrors = consoleErrors.flatMap((entry, index) =>
            entry.kind === "console" &&
            entry.url === response.url &&
            entry.text.startsWith(
              `Failed to load resource: the server responded with a status of ${expected.status}`,
            ) ? [index] : []);
          expect(
            matchingConsoleErrors.length <= 1,
            "expected HTTP error produced duplicate console errors",
          ).toBe(true);
          if (matchingConsoleErrors.length === 1) {
            allowedConsoleErrors.add(matchingConsoleErrors[0]);
          }
        }
        const hasUnexpectedConsoleError = consoleErrors.some((_, index) =>
          !allowedConsoleErrors.has(index));
        expect(hasUnexpectedConsoleError, "browser console contained an unexpected error").toBe(false);
      },
      expectHttpError(error) {
        expectedHttpErrors.push(error);
      },
    };
    await use(evidence);
    await Promise.allSettled(pending);
    const dom = await page.locator("body").innerText().catch(() => "");
    await writeFile(
      testInfo.outputPath("console.log"),
      redact(`${consoleLines.join("\n")}\n`, stack.secret),
    );
    await writeFile(
      testInfo.outputPath("network-summary.json"),
      redact(JSON.stringify(network, null, 2), stack.secret),
    );
    await writeFile(testInfo.outputPath("dom.txt"), redact(dom, stack.secret));
  },
});

export { expect, type Page };
