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
import { runAgentExecution as defaultRunAgentExecution } from "./agent-execution.mjs";

// --- Shared agent session creation (reused by SSE adapter and injected into runAgentExecution) ---
export async function createAgentSessionForAgent(agentConfig, apiKey, agentDir) {
  const { createAgentSession, ModelRuntime, SessionManager, SettingsManager } =
    await import("@earendil-works/pi-coding-agent");

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
    cwd: agentDir,
    agentDir,
    modelRuntime,
    model: modelRuntime.getModel("custom", agentConfig.model),
    sessionManager: SessionManager.inMemory(agentDir),
    settingsManager: SettingsManager.inMemory(),
  });

  // Apply system prompt after session creation (createAgentSession ignores systemPrompt option)
  if (agentConfig.system_prompt && result.session.agent?.state) {
    result.session.agent.state.systemPrompt = agentConfig.system_prompt;
  }

  return result.session;
}

/**
 * Error thrown by the task adapter. Carries a machine-readable `kind`
 * (agent_not_found | missing_env_var | provider_error | internal_error) that
 * the Hono /api/task/* routes translate to {code, message}. `cancelled` is
 * NEVER a kind — it's a terminal phase, projected to a normal return.
 */
export class AgentExecutionError extends Error {
  constructor({ kind, message, detail }) {
    super(message);
    this.name = "AgentExecutionError";
    this.kind = kind;
    this.detail = detail;
  }
}

// --- AgentExecutor: replaces built-in LLMExecutor in runtime-js ---
class AgentExecutor {
  constructor({
    db,
    agentDir,
    createSession = createAgentSessionForAgent,
    runAgentExecution = defaultRunAgentExecution,
    environment = process.env,
  }) {
    this.type = "llm";
    this.db = db;
    this.agentDir = agentDir;
    this.createSession = createSession;
    this.runAgentExecution = runAgentExecution;
    this.environment = environment;
  }

  async execute(context) {
    const { agentId, prompt } = context.inputs;
    if (!agentId) {
      throw new AgentExecutionError({ kind: "agent_not_found", message: "agentId is required" });
    }
    if (!prompt) {
      throw new AgentExecutionError({ kind: "agent_not_found", message: "prompt is required" });
    }

    const agent = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    if (!agent) {
      throw new AgentExecutionError({ kind: "agent_not_found", message: `agent not found: ${agentId}` });
    }

    const apiKey = this.environment[agent.provider_api_key_env];
    if (!apiKey) {
      throw new AgentExecutionError({
        kind: "missing_env_var",
        message: `missing env var: ${agent.provider_api_key_env}`,
        detail: { envVar: agent.provider_api_key_env },
      });
    }

    // Bind apiKey into the createSession closure — the shared module never
    // resolves credentials (#66 rule). 2-arg form: (agentConfig, agentDir).
    const createSessionBound = (agentConfig, agentDir) =>
      this.createSession(agentConfig, apiKey, agentDir);

    let terminal;
    try {
      const events = this.runAgentExecution({
        agentConfig: agent,
        prompt,
        signal: context.signal,
        createSession: createSessionBound,
        agentDir: this.agentDir,
      });
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
    }

    if (!terminal) {
      // Iterable ended without a terminal (shared module bug). Defensive.
      throw new AgentExecutionError({
        kind: "internal_error",
        message: "Agent Execution ended without a terminal event",
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
export function initRuntime(db, agentDir) {
  registerNodeExecutor(createAgentExecutor({ db, agentDir }));
}

export { TaskRunAPI, TaskReportAPI, TaskCancelAPI, TaskValidateAPI, TaskResultAPI };
