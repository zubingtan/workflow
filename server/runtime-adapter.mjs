/**
 * Runtime adapter: imports @flowgram.ai/runtime-js on the server side,
 * registers a custom AgentExecutor to replace the built-in LLMExecutor,
 * and re-exports the FlowGram Task APIs for use in Hono endpoints.
 *
 * The executor delegates to the shared Agent Execution module
 * (server/agent-execution.mjs) — it owns NO pi session lifecycle, subscribe
 * handler, or abort relay. It resolves the agent + apiKey, binds apiKey into a
 * createSession closure, iterates runAgentExecution's events, and projects the
 * single terminal event to FlowGram's expected return/throw shape (#77).
 */
import { registerNodeExecutor, TaskRunAPI, TaskReportAPI, TaskCancelAPI, TaskValidateAPI, TaskResultAPI } from "@flowgram.ai/runtime-js";
import { join } from "node:path";
import { runAgentExecution as defaultRunAgentExecution } from "./agent-execution.mjs";
import { getAgentById } from "./agent-catalog.mjs";
import { buildMem0Config, writeMem0Config, ensureMem0Extension } from "./mem0-integration.mjs";

// --- Shared agent session creation (reused by SSE adapter and injected into runAgentExecution) ---
//
// Mem0 wiring (#212 D2/D4/D15): before creating the session we write the
// per-run config ({agentDir}/mem0-config.json) and ensure the extension is
// discoverable at {agentDir}/extensions/pi-extension-mem0/ (pi's
// DefaultResourceLoader scans that dir). After session creation we activate
// the extension lifecycle with bindExtensions({ mode: "print" }). All of it
// is best-effort: any failure degrades memory to off without blocking the
// run (D10).
//
// Per-agent session dir: the passed `agentDir` is the shared agents root
// ({DATA_DIR}/agents). Each agent's session runs in its own
// {agentDir}/{agentId}/ subdirectory so mem0-config.json and
// extensions/ are per-agent — concurrent runs of different agents can
// never clobber each other's config (review finding; also user story 3:
// every agent has an isolated memory space).
export async function createAgentSessionForAgent(agentConfig, apiKey, agentDir, runId = "", settingsProvider = null) {
  const { createAgentSession, ModelRuntime, SessionManager, SettingsManager } =
    await import("@earendil-works/pi-coding-agent");

  // Per-agent session dir (review fix): isolates mem0 config + extensions.
  const sessionDir = join(agentDir, agentConfig.id ?? "agent");

  // D4: write per-run mem0 config (host/apiKey from the settings table).
  try {
    const mem0Config = buildMem0Config({
      agentId: agentConfig.id,
      runId,
      settingsProvider,
    });
    writeMem0Config(sessionDir, mem0Config);
    // D2/D15: make the extension discoverable via file discovery.
    ensureMem0Extension(sessionDir);
  } catch (err) {
    // Memory is an enhancement, never a dependency (D10).
    console.warn("[mem0] integration setup failed; run continues without memory:", err?.message ?? err);
  }

  const modelRuntime = await ModelRuntime.create({ modelsPath: null });
  modelRuntime.registerProvider("custom", {
    name: agentConfig.name,
    baseUrl: agentConfig.provider_base_url,
    apiKey,
    api: "openai-completions",
    models: [{
      id: agentConfig.model,
      name: agentConfig.model,
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    }],
  });

  const result = await createAgentSession({
    cwd: sessionDir,
    agentDir: sessionDir,
    modelRuntime,
    model: modelRuntime.getModel("custom", agentConfig.model),
    sessionManager: SessionManager.inMemory(sessionDir),
    settingsManager: SettingsManager.inMemory(),
  });

  // D2: activate the extension lifecycle. bindExtensions() also triggers
  // extendResourcesFromExtensions() — skills the extension registers join the
  // system prompt (expected behavior, per #203).
  try {
    await result.session.bindExtensions({ mode: "print" });
  } catch (err) {
    // A failing extension must not block the run (D10).
    console.warn("[mem0] bindExtensions failed; memory disabled for this run:", err?.message ?? err);
  }

  // Apply system prompt after session creation (createAgentSession ignores systemPrompt option)
  if (agentConfig.system_prompt && result.session.agent?.state) {
    result.session.agent.state.systemPrompt = agentConfig.system_prompt;
  }

  return result.session;
}

/**
 * Error thrown by the task adapter. Carries a machine-readable `kind`
 * (agent_not_found | provider_error | internal_error | timeout) that the Hono
 * /api/task/* routes translate to {code, message}. `cancelled` is NEVER a
 * kind — it's a terminal phase, projected to a normal return.
 */
export class AgentExecutionError extends Error {
  constructor({ kind, message, detail }) {
    super(message);
    this.name = "AgentExecutionError";
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * Phase 9 (#161): resolve the per-node timeout in milliseconds.
 *
 * Precedence (#148):
 *   1. node.data.timeoutOverride
 *        - number > 0 → that many ms
 *        - 0 OR null  → "no timeout" (the 不超时 option) — returns 0
 *        - undefined  → fall through to global default
 *   2. settings table global default (getNodeTimeoutDefaultMs)
 *   3. process.env.NODE_TIMEOUT_MS
 *   4. 10 * 60 * 1000 (10 minutes)
 *
 * `node` is the FlowGram node entity (context.node in execute). `settings` is
 * a thin helper object with `getNodeTimeoutDefaultMs()` (server/settings.mjs).
 * Returns 0 to signal "no timeout" (the 不超时 option).
 */
export function resolveTimeoutMs(node, settings) {
  const override = node?.data?.timeoutOverride;
  if (override === null) return 0;
  if (override !== undefined) return override;
  const globalDefault = settings?.getNodeTimeoutDefaultMs?.();
  if (globalDefault != null) return globalDefault;
  return process.env.NODE_TIMEOUT_MS ? Number(process.env.NODE_TIMEOUT_MS) : 10 * 60 * 1000;
}

// --- AgentExecutor: replaces built-in LLMExecutor in runtime-js ---
class AgentExecutor {
  constructor({
    db,
    agentDir,
    createSession = createAgentSessionForAgent,
    runAgentExecution = defaultRunAgentExecution,
    resolveTimeoutMs: resolveTimeoutMsFn = resolveTimeoutMs,
    settingsProvider = null,
  }) {
    this.type = "llm";
    this.db = db;
    this.agentDir = agentDir;
    this.createSession = createSession;
    this.runAgentExecution = runAgentExecution;
    this.resolveTimeoutMs = resolveTimeoutMsFn;
    this.settingsProvider = settingsProvider;
  }

  async execute(context) {
    const { agentId, prompt } = context.inputs;
    // D3: the workflow runID travels via the top-level workflow inputs
    // (queue-adapter injects __run_id) — node inputs only carry the node's
    // own schema fields, so fall back to the runtime's ioCenter inputs.
    const runID =
      context.inputs?.__run_id ??
      context.runtime?.ioCenter?.inputs?.__run_id ??
      "";
    if (!agentId) {
      throw new AgentExecutionError({ kind: "agent_not_found", message: "agentId is required" });
    }
    if (!prompt) {
      throw new AgentExecutionError({ kind: "agent_not_found", message: "prompt is required" });
    }

    const agent = getAgentById(this.db, agentId);
    if (!agent) {
      throw new AgentExecutionError({ kind: "agent_not_found", message: `agent not found: ${agentId}` });
    }

    const apiKey = agent.provider_api_key;

    // Bind apiKey into the createSession closure — the shared module never
    // resolves credentials (#66 rule). 4-arg form: (agentConfig, agentDir,
    // runID, settingsProvider). runID feeds mem0 provenance (D3);
    // settingsProvider feeds mem0_host/mem0_api_key (D12).
    const createSessionBound = (agentConfig, agentDir, runID) =>
      this.createSession(agentConfig, apiKey, agentDir, runID, this.settingsProvider);

    // Phase 9 (#161): per-node timeout via a per-node AbortController.
    // AbortSignal.any combines the workflow signal (user cancel) with the
    // timeout signal so either aborts the shared module.
    // timeoutMs=0 means "no timeout" (the 不超时 option) — skip the wrap.
    //
    // Implementation note: the spec (#140) suggested Promise.race, but a JS
    // async generator can only have ONE consumer — two for-await loops on the
    // same generator would hang or error. Instead, the timer sets `timedOut`
    // and aborts `ac` when it fires. The shared module's signal.aborted
    // bridge (agent-execution.mjs:102-110) then calls the awaitable
    // `session.abort()` and yields a `cancelled` terminal, which the single
    // for-await loop observes. After the loop exits, `timedOut` drives
    // classification. Semantically equivalent to Promise.race for this
    // single-consumer case; avoids the multi-consumer pitfall.
    const timeoutMs = this.resolveTimeoutMs(context.node, this.settingsProvider);
    const workflowSignal = context.signal;
    const useTimeout = typeof timeoutMs === "number" && timeoutMs > 0;

    let terminal;
    let timedOut = false;
    let ac = null;
    let combinedSignal = workflowSignal;
    let timer = null;

    if (useTimeout) {
      ac = new AbortController();
      combinedSignal = AbortSignal.any([workflowSignal ?? new AbortController().signal, ac.signal]);
      timer = setTimeout(() => {
        timedOut = true;
        ac.abort("node_timeout");
      }, timeoutMs);
    }

    try {
      const events = this.runAgentExecution({
        agentConfig: agent,
        prompt,
        signal: combinedSignal,
        createSession: createSessionBound,
        agentDir: this.agentDir,
        // D3: workflow runID (nanoid(12), queue-assigned) — mem0 provenance.
        runID,
      });
      // Single consumer. The timer's ac.abort() triggers the shared module's
      // signal.aborted path, which yields a `cancelled` terminal — the loop
      // then exits naturally. No Promise.race needed (see impl note above).
      for await (const ev of events) {
        if (ev.type === "terminal") {
          terminal = ev;
          break;
        }
        // Non-terminal events (content_delta / tool_start / tool_end) are
        // ignored by the task adapter — it only needs the accumulated terminal.
      }
    } catch (err) {
      // Defensive: the shared module is expected to classify all errors into a
      // terminal, not throw. If it does throw, surface as internal_error (never
      // leak a raw Error to FlowGram's engine, which would race TaskCancelAPI).
      throw err instanceof AgentExecutionError
        ? err
        : new AgentExecutionError({ kind: "internal_error", message: err?.message ?? "internal error" });
    } finally {
      if (timer) clearTimeout(timer);
      // #66 lesson: session.abort() is awaitable. But here we don't own the
      // session — the shared module does, and it already bridges signal.aborted
      // → session.abort() internally. The per-node ac.abort() above triggers
      // that bridge. No additional session.abort() call needed here; the
      // shared module's finally block disposes the session.
    }

    if (!terminal) {
      // Iterable ended without a terminal (shared module bug). Defensive.
      throw new AgentExecutionError({
        kind: "internal_error",
        message: "Agent Execution ended without a terminal event",
      });
    }

    // Phase 9 (#161/#66): timeout classification. If the per-node AbortController
    // fired (timedOut=true), the terminal is a `cancelled` from the shared
    // module's signal.aborted path — re-classify as a `failed` timeout per
    // #140 (timeout ≠ Cancellation). The workflow signal (user cancel) keeps
    // its `cancelled` projection (terminated:"cancelled") — #66 precedence.
    if (timedOut && ac?.signal.aborted && !workflowSignal?.aborted) {
      throw new AgentExecutionError({
        kind: "timeout",
        message: `node timed out after ${timeoutMs}ms`,
        detail: {
          reason: "node_timeout",
          partialText: terminal.partialText,
          toolEvents: terminal.toolEvents,
        },
      });
    }

    // Terminal projection — preserves #56 decision 2 (no thrown
    // CancellationError) + decision 6 (_executionDetail namespace).
    switch (terminal.phase) {
      case "succeeded":
        return {
          outputs: {
            result: terminal.partialText,
            _executionDetail: { toolEvents: terminal.toolEvents },
          },
        };
      case "cancelled":
        return {
          outputs: {
            result: terminal.partialText,
            _executionDetail: { toolEvents: terminal.toolEvents, terminated: "cancelled" },
          },
        };
      case "failed":
        throw new AgentExecutionError(
          terminal.error ?? { kind: "provider_error", message: "Agent Execution failed" },
        );
      default:
        throw new AgentExecutionError({
          kind: "internal_error",
          message: `unknown terminal phase: ${terminal.phase}`,
        });
    }
  }
}

export function createAgentExecutor(options) {
  return new AgentExecutor(options);
}

// --- Register the custom executor (must be called before any TaskRun) ---
export function initRuntime(db, agentDir, settingsProvider = null) {
  registerNodeExecutor(
    createAgentExecutor({ db, agentDir, settingsProvider })
  );
}

export { TaskRunAPI, TaskReportAPI, TaskCancelAPI, TaskValidateAPI, TaskResultAPI };
