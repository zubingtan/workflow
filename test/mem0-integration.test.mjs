/**
 * Seam 2 (#212): mem0 backend integration tests.
 *
 * Covers the pieces `createAgentSessionForAgent` needs to wire mem0 into a
 * pi agent session (D2/D4/D15):
 *   1. buildMem0Config — the per-run config shape written before every run
 *   2. writeMem0Config — {agentDir}/mem0-config.json on disk
 *   3. ensureMem0Extension — {agentDir}/extensions/pi-extension-mem0/ exists
 *      (symlink from the packaged dist, or no-op when unavailable = graceful
 *      degradation, D10)
 *   4. createAgentSessionForAgent — writes the config, ensures the extension
 *      dir, and calls session.bindExtensions({ mode: "print" }) after session
 *      creation (D2). The pi package is module-mocked so no real session is
 *      created.
 */
import { test, describe, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readlinkSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const {
  buildMem0Config,
  writeMem0Config,
  ensureMem0Extension,
  MEM0_EXTENSION_NAME,
} = await import("../server/mem0-integration.mjs");

function tempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("buildMem0Config (D4 shape)", () => {
  test("produces the exact self-hosted config shape", () => {
    const settingsProvider = {
      getSetting: (k) => (k === "mem0_host" ? "http://mem0:8000" : k === "mem0_api_key" ? "secret" : null),
    };
    const cfg = buildMem0Config({
      agentId: "agent-1",
      runId: "run-abc",
      settingsProvider,
    });
    assert.deepEqual(cfg, {
      selfHosted: true,
      host: "http://mem0:8000",
      apiKey: "secret",
      agentId: "agent-1",
      runId: "run-abc",
      autoCapture: true,
      contextInjection: true,
      searchThreshold: 0.3,
      dream: { enabled: false },
    });
  });

  test("host/apiKey default to empty when settings are absent (graceful off)", () => {
    const cfg = buildMem0Config({ agentId: "a1", runId: "r1" });
    assert.equal(cfg.host, "");
    assert.equal(cfg.apiKey, "");
  });
});

describe("writeMem0Config (D4)", () => {
  test("writes JSON to {agentDir}/mem0-config.json", () => {
    const dir = tempDir("mem0-cfg-");
    const cfg = buildMem0Config({
      agentId: "a1",
      runId: "r1",
      settingsProvider: {
        getSetting: (k) => (k === "mem0_host" ? "http://h" : k === "mem0_api_key" ? "k" : null),
      },
    });
    writeMem0Config(dir, cfg);
    const onDisk = JSON.parse(readFileSync(join(dir, "mem0-config.json"), "utf8"));
    assert.deepEqual(onDisk, cfg);
  });
});

describe("ensureMem0Extension (D2/D15)", () => {
  test("symlinks the packaged dist into {agentDir}/extensions/ when source exists", () => {
    const agentDir = tempDir("mem0-ext-agent-");
    const sourceDir = tempDir("mem0-ext-src-");
    writeFileSync(join(sourceDir, "entry.js"), "export default () => {};");

    ensureMem0Extension(agentDir, { sourceDir });

    const target = join(agentDir, "extensions", MEM0_EXTENSION_NAME);
    assert.ok(existsSync(target), "extension dir should exist");
    assert.equal(readlinkSync(target), sourceDir, "should be a symlink to the source dist");
  });

  test("keeps an existing extension dir untouched", () => {
    const agentDir = tempDir("mem0-ext-agent-");
    const existing = join(agentDir, "extensions", MEM0_EXTENSION_NAME);
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, "keep.txt"), "keep");

    const sourceDir = tempDir("mem0-ext-src-");
    ensureMem0Extension(agentDir, { sourceDir });

    assert.ok(existsSync(join(existing, "keep.txt")), "existing dir must not be replaced");
  });

  test("no-ops when no source dist is available (D10 graceful degradation)", () => {
    const agentDir = tempDir("mem0-ext-agent-");
    ensureMem0Extension(agentDir, { sourceDir: join(agentDir, "does-not-exist") });
    assert.ok(!existsSync(join(agentDir, "extensions", MEM0_EXTENSION_NAME)));
  });

  test("replaces a dangling symlink when the source reappears (self-healing)", () => {
    const agentDir = tempDir("mem0-ext-agent-");
    // First install pointing at a source that later disappears.
    const goneSource = tempDir("mem0-ext-gone-");
    ensureMem0Extension(agentDir, { sourceDir: goneSource });
    assert.ok(existsSync(join(agentDir, "extensions", MEM0_EXTENSION_NAME)));
    rmSync(goneSource, { recursive: true, force: true });
    assert.ok(!existsSync(join(agentDir, "extensions", MEM0_EXTENSION_NAME)), "dangling now");

    // Source reappears → next ensure must replace the broken link.
    const newSource = tempDir("mem0-ext-new-");
    writeFileSync(join(newSource, "entry.js"), "export default () => {};");
    ensureMem0Extension(agentDir, { sourceDir: newSource });

    assert.ok(existsSync(join(agentDir, "extensions", MEM0_EXTENSION_NAME)));
    assert.equal(readlinkSync(join(agentDir, "extensions", MEM0_EXTENSION_NAME)), newSource);
  });

  test("defaults to MEM0_EXTENSION_DIR env or the workspace dist path", () => {
    const agentDir = tempDir("mem0-ext-agent-");
    const sourceDir = tempDir("mem0-ext-src-");
    const prev = process.env.MEM0_EXTENSION_DIR;
    process.env.MEM0_EXTENSION_DIR = sourceDir;
    try {
      ensureMem0Extension(agentDir);
      assert.ok(existsSync(join(agentDir, "extensions", MEM0_EXTENSION_NAME)));
    } finally {
      if (prev === undefined) delete process.env.MEM0_EXTENSION_DIR;
      else process.env.MEM0_EXTENSION_DIR = prev;
    }
  });
});

// --- createAgentSessionForAgent integration (pi module mocked) ---

describe("createAgentSessionForAgent (D2 seam 2)", () => {
  let agentDir;
  let sessionMock;
  let boundExtensions;

  beforeEach(() => {
    agentDir = tempDir("mem0-session-");
    boundExtensions = [];
    sessionMock = {
      agent: { state: { systemPrompt: "" } },
      bindExtensions: mock.fn(async (bindings) => {
        boundExtensions.push(bindings);
      }),
    };
    mock.module("@earendil-works/pi-coding-agent", {
      namedExports: {
        createAgentSession: async () => ({ session: sessionMock }),
        ModelRuntime: {
          create: async () => ({
            registerProvider: () => {},
            getModel: () => ({}),
          }),
        },
        SessionManager: { inMemory: () => ({}) },
        SettingsManager: { inMemory: () => ({}) },
      },
    });
  });

  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
    mock.reset();
  });

  test("writes mem0-config.json with agentId/runId and calls bindExtensions", async () => {
    // The mocked createAgentSession is picked up only if the module under
    // test imports it AFTER the mock is registered — import happens lazily
    // inside createAgentSessionForAgent, so we import the adapter here.
    const { createAgentSessionForAgent } = await import("../server/runtime-adapter.mjs");

    const sourceDir = tempDir("mem0-src-");
    writeFileSync(join(sourceDir, "entry.js"), "export default () => {};");
    process.env.MEM0_EXTENSION_DIR = sourceDir;
    try {
      const settingsProvider = {
        getSetting: (k) => (k === "mem0_host" ? "http://localhost:8890" : k === "mem0_api_key" ? "admin-key" : null),
      };
      const session = await createAgentSessionForAgent(
        { id: "agent-9", name: "A", provider_base_url: "http://x", model: "m", system_prompt: "sys" },
        "api-key",
        agentDir,
        "run-42",
        settingsProvider,
      );

      assert.equal(session, sessionMock);
      // Config written per-agent (review fix: concurrent runs of different
      // agents must never clobber each other's config) + identity (D4).
      const agentSessionDir = join(agentDir, "agent-9");
      const cfg = JSON.parse(readFileSync(join(agentSessionDir, "mem0-config.json"), "utf8"));
      assert.equal(cfg.agentId, "agent-9");
      assert.equal(cfg.runId, "run-42");
      assert.equal(cfg.host, "http://localhost:8890");
      assert.equal(cfg.apiKey, "admin-key");
      // Extension dir ensured per-agent (D2/D15)
      assert.ok(existsSync(join(agentSessionDir, "extensions", MEM0_EXTENSION_NAME)));
      // bindExtensions called with print mode (D2)
      assert.equal(sessionMock.bindExtensions.mock.callCount(), 1);
      assert.deepEqual(boundExtensions[0], { mode: "print" });
    } finally {
      delete process.env.MEM0_EXTENSION_DIR;
    }
  });

  test("run still works when mem0 is not configured (D10: empty config, no bind failure)", async () => {
    const { createAgentSessionForAgent } = await import("../server/runtime-adapter.mjs");
    const session = await createAgentSessionForAgent(
      { id: "agent-9", name: "A", provider_base_url: "http://x", model: "m", system_prompt: "sys" },
      "api-key",
      agentDir,
      "run-42",
      null,
    );
    assert.equal(session, sessionMock);
    // Config is still written (clearing settings must disable memory), but
    // host is empty so the extension stays inert — run unaffected (D10).
    const cfg = JSON.parse(readFileSync(join(agentDir, "agent-9", "mem0-config.json"), "utf8"));
    assert.equal(cfg.host, "");
    assert.equal(sessionMock.bindExtensions.mock.callCount(), 1);
  });

  test("concurrent runs of different agents write isolated configs (review fix)", async () => {
    const { createAgentSessionForAgent } = await import("../server/runtime-adapter.mjs");
    const settingsProvider = {
      getSetting: (k) => (k === "mem0_host" ? "http://localhost:8890" : k === "mem0_api_key" ? "k" : null),
    };
    // Simulate two agents starting runs at the same time.
    await Promise.all([
      createAgentSessionForAgent(
        { id: "agent-A", name: "A", provider_base_url: "http://x", model: "m", system_prompt: "s" },
        "key",
        agentDir,
        "run-A",
        settingsProvider,
      ),
      createAgentSessionForAgent(
        { id: "agent-B", name: "B", provider_base_url: "http://x", model: "m", system_prompt: "s" },
        "key",
        agentDir,
        "run-B",
        settingsProvider,
      ),
    ]);

    const cfgA = JSON.parse(readFileSync(join(agentDir, "agent-A", "mem0-config.json"), "utf8"));
    const cfgB = JSON.parse(readFileSync(join(agentDir, "agent-B", "mem0-config.json"), "utf8"));
    assert.equal(cfgA.agentId, "agent-A");
    assert.equal(cfgA.runId, "run-A");
    assert.equal(cfgB.agentId, "agent-B");
    assert.equal(cfgB.runId, "run-B");
  });

  test("bindExtensions failure does not block the run (D10)", async () => {
    sessionMock.bindExtensions = mock.fn(async () => {
      throw new Error("extension boom");
    });
    const { createAgentSessionForAgent } = await import("../server/runtime-adapter.mjs");
    const session = await createAgentSessionForAgent(
      { id: "agent-9", name: "A", provider_base_url: "http://x", model: "m", system_prompt: "sys" },
      "api-key",
      agentDir,
      "run-42",
      null,
    );
    assert.equal(session, sessionMock);
  });
});
