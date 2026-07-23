/**
 * Runtime adapter: imports @flowgram.ai/runtime-js on the server side,
 * registers a custom AgentExecutor to replace the built-in LLMExecutor,
 * and re-exports the FlowGram Task APIs for use in Hono endpoints.
 */
import { registerNodeExecutor, TaskRunAPI, TaskReportAPI, TaskCancelAPI, TaskValidateAPI } from "@flowgram.ai/runtime-js";

// --- Shared agent session creation (reused by AgentExecutor and runAgentSse) ---
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

// --- AgentExecutor: replaces built-in LLMExecutor in runtime-js ---
class AgentExecutor {
  constructor({
    db,
    agentDir,
    createSession = createAgentSessionForAgent,
    environment = process.env,
  }) {
    this.type = "llm";
    this.db = db;
    this.agentDir = agentDir;
    this.createSession = createSession;
    this.environment = environment;
  }

  async execute(context) {
    const { agentId, prompt } = context.inputs;
    if (!agentId) throw new Error("agentId is required");
    if (!prompt) throw new Error("prompt is required");

    const agent = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(agentId);
    if (!agent) throw new Error(`agent not found: ${agentId}`);

    const apiKey = this.environment[agent.provider_api_key_env];
    if (!apiKey) throw new Error(`missing env var: ${agent.provider_api_key_env}`);

    const session = await this.createSession(agent, apiKey, this.agentDir);
    const abort = () => {
      void session.abort?.();
    };
    if (context.signal?.aborted) {
      abort();
    } else {
      context.signal?.addEventListener("abort", abort, { once: true });
    }

    let fullText = "";
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update") {
        const e = event.assistantMessageEvent;
        if (e?.type === "text_delta" && e.delta) fullText += e.delta;
      }
    });

    try {
      await session.prompt(prompt);
      await session.agent.waitForIdle();
    } finally {
      context.signal?.removeEventListener("abort", abort);
      unsubscribe();
      session.dispose?.();
    }

    return { outputs: { result: fullText } };
  }
}

export function createAgentExecutor(options) {
  return new AgentExecutor(options);
}

// --- Register the custom executor (must be called before any TaskRun) ---
export function initRuntime(db, agentDir) {
  registerNodeExecutor(createAgentExecutor({ db, agentDir }));
}

export { TaskRunAPI, TaskReportAPI, TaskCancelAPI, TaskValidateAPI };
