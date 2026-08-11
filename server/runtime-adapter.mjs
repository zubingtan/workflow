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
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, writeFileSync, existsSync, cpSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  registerNodeExecutor,
  TaskRunAPI,
  TaskReportAPI,
  TaskCancelAPI,
  TaskValidateAPI,
  TaskResultAPI,
} from '@flowgram.ai/runtime-js';
import { runAgentExecution as defaultRunAgentExecution } from './agent-execution.mjs';
import { getAgentById } from './agent-catalog.mjs';
import { persistExecution } from './execution-store.mjs';
import { getMem0Host, getMem0ApiKey } from './settings.mjs';
import {
  compileStrictSchema,
  createStructuredOutputPayloadExtension,
  createStructuredOutputTool,
  StructuredOutputCapabilityError,
  STRUCTURED_OUTPUT_GUIDELINES,
} from './structured-output.mjs';
import { executeFeishuBot } from './feishu-executor.mjs';
import { resolveSkillPaths } from './skills.mjs';

// API shapes that can honor the structured output contract (#248).
// The model registry pins `api` per registered model; anything outside these
// two shapes fails fast at session creation with a capability error. Since
// #320 the contract rides the tools array (StructuredOutput customTool), but
// the shape gate stays — unknown shapes can't carry tool loops either.
const STRUCTURED_OUTPUT_API_SHAPES = new Set(['openai-completions', 'openai-responses']);

// AsyncLocalStorage carries the workflow_run_id from the queue-adapter
// through the FlowGram TaskRunAPI call chain into the AgentExecutor,
// without modifying FlowGram's ExecutionContext interface.
export const workflowRunContext = new AsyncLocalStorage();

// --- mem0 extension helpers (#218) ---

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Ensure the mem0 extension files exist in {agentSessionDir}/extensions/pi-extension-mem0/.
 * Sources (first found wins):
 *   1. /opt/pi-extension-mem0/ (Docker production)
 *   2. packages/pi-extension-mem0/dist/ (development, relative to server/)
 * Returns true if extension is available, false otherwise.
 */
export function ensureMem0Extension(agentSessionDir) {
  const targetDir = join(agentSessionDir, 'extensions', 'pi-extension-mem0');
  if (existsSync(join(targetDir, 'index.js'))) return true; // already present

  const candidates = [
    '/opt/pi-extension-mem0',
    join(__dirname, '..', 'packages', 'pi-extension-mem0', 'dist'),
  ];
  for (const src of candidates) {
    if (existsSync(join(src, 'index.js'))) {
      mkdirSync(targetDir, { recursive: true });
      cpSync(src, targetDir, { recursive: true });
      return true;
    }
  }
  return false; // extension not built yet — graceful skip
}

/**
 * Write {agentSessionDir}/mem0-config.json for the pi-extension-mem0 to read.
 * Only writes when mem0 is configured (host + apiKey present in settings).
 * Uses atomic write (tmp + rename) to prevent half-read on concurrent access.
 *
 * Note: config is per-agent (not per-run). If the same agent runs concurrently
 * from different workflows, runId may be overwritten. The write→read window is
 * sub-millisecond (both happen synchronously within createAgentSessionForAgent),
 * so practical risk is minimal. Per-run isolation is a future hardening.
 */
export function writeMem0Config(agentSessionDir, { agentId, runId, host, apiKey }) {
  const config = {
    selfHosted: true,
    host,
    apiKey,
    agentId: String(agentId),
    runId: runId || undefined,
    autoCapture: true,
    contextInjection: true,
    searchThreshold: 0.3,
    dream: { enabled: false },
  };
  mkdirSync(agentSessionDir, { recursive: true });
  const target = join(agentSessionDir, 'mem0-config.json');
  const tmp = join(agentSessionDir, '.mem0-config.json.tmp');
  writeFileSync(tmp, JSON.stringify(config, null, 2));
  renameSync(tmp, target); // atomic on POSIX
}

// --- Shared agent session creation (reused by SSE adapter and injected into runAgentExecution) ---

/**
 * Resolve api_key: "$ENV_VAR" → process.env lookup; otherwise literal value.
 */
export function resolveApiKey(rawValue) {
  if (!rawValue) return '';
  if (rawValue.startsWith('$')) {
    return process.env[rawValue.slice(1)] ?? '';
  }
  return rawValue;
}

/**
 * Responses API store compatibility: pi streams Responses requests with
 * store:false (stateless, OpenAI-official behavior). LiteLLM/Azure gateways
 * reject function_call_output items whose originating response was not
 * persisted ("Item with id ... not found"), which breaks multi-turn tool
 * loops. Force store:true for non-OpenAI endpoints so tool calls survive;
 * official OpenAI keeps the stateless default.
 *
 * @param {{ endpoint?: string, store?: boolean }} opts - `store` is the
 *   provider.responses_store escape hatch: true/false pins the behavior,
 *   undefined falls back to the endpoint heuristic (non-OpenAI → true).
 */
export function createResponsesStoreCompatExtension({ endpoint, store }) {
  const isOfficialOpenAI = /api\.openai\.com/i.test(endpoint ?? '');
  const forced = typeof store === 'boolean' ? store : undefined;
  return (api) => {
    api.on('before_provider_request', (event) => {
      const payload = event.payload;
      if (!payload || payload.store === undefined) return;
      const target = forced ?? !isOfficialOpenAI;
      if (payload.store === target) return;
      return { ...payload, store: target };
    });
  };
}

/**
 * Create a pi-coding-agent session from an agent record.
 * @param {object} agent - DB row or constructed object with { name, config (string|object) }
 * @param {string} agentDir - working directory for the agent
 * @param {object} [mem0] - Optional mem0 config { host, apiKey, runId }. When
 *   provided, writes mem0-config.json and activates the memory extension.
 * @param {{ schema: object, name: string }|null} [structured] - compiled
 *   structured output contract (compileStrictSchema result) for THIS run, or
 *   null when the node declares no structured outputs. The contract is
 *   captured by a request-scoped inline extension so it can never leak across
 *   sessions (#248); sessions without a contract never inject response_format.
 * @param {string} [skillsDir] - explicit skills library dir. Defaults to
 *   <agentDir parent>/skills; callers that know the real library dir (e.g.
 *   DATA_DIR/skills) pass it so the agent dir layout never dictates resolution.
 * @throws {StructuredOutputCapabilityError} when structured is set but the
 *   provider's API shape cannot honor json_schema (fail fast, before any
 *   provider request is sent).
 */
export async function createAgentSessionForAgent(agent, agentDir, mem0, structured, skillsDir) {
  const {
    createAgentSession,
    ModelRuntime,
    SessionManager,
    SettingsManager,
    DefaultResourceLoader,
  } = await import('@earendil-works/pi-coding-agent');

  const config = typeof agent.config === 'string' ? JSON.parse(agent.config) : agent.config ?? {};
  const provider = config.provider ?? {};
  const sessionOptions = config.session_options ?? {};
  const piSettings = config.pi_settings ?? {};

  const apiKey = resolveApiKey(provider.api_key);
  const model = provider.model || 'gpt-4o';
  const pricing = provider.pricing ?? { input: 0, output: 0 };

  // 0. Capability check (#248): the model's API shape must be able to carry
  // the StructuredOutput tool loop (tools in the payload + toolCall results
  // back). Fail fast BEFORE any provider request — no fallback to
  // json_object or plain text.
  const modelApi = provider.api ?? 'openai-completions';
  if (structured && !STRUCTURED_OUTPUT_API_SHAPES.has(modelApi)) {
    throw new StructuredOutputCapabilityError({
      provider: provider.name ?? 'custom',
      model,
      endpoint: provider.base_url,
      apiShape: modelApi,
      detail: 'model API shape has no tool-calling loop for structured output',
    });
  }

  // 1. ModelRuntime — register custom provider
  const modelRuntime = await ModelRuntime.create({ modelsPath: null });
  modelRuntime.registerProvider('custom', {
    name: agent.name || 'custom',
    baseUrl: provider.base_url,
    apiKey,
    api: modelApi,
    models: [
      {
        id: model,
        name: model,
        api: modelApi,
        reasoning: false,
        input: ['text'],
        cost: {
          input: pricing.input ?? 0,
          output: pricing.output ?? 0,
          cacheRead: pricing.cacheRead ?? 0,
          cacheWrite: pricing.cacheWrite ?? 0,
        },
        contextWindow: 128000,
        maxTokens: 8192,
      },
    ],
  });

  // 2. SettingsManager — inject pi_settings (transparent passthrough). Skill
  // entries are library names in the agent config; resolve them to absolute
  // paths here so pi-agent keeps working on paths untouched (#307). Existing
  // absolute paths pass through; unknown names are skipped with a warning.
  const skillsLibraryDir = skillsDir ?? join(dirname(agentDir), 'skills');
  const { paths: resolvedSkillPaths, skipped: skippedSkills } = resolveSkillPaths(
    skillsLibraryDir,
    piSettings.skills
  );
  if (skippedSkills.length > 0) {
    console.warn(
      `[skills] agent ${agent.id} references missing skill(s), skipped: ${skippedSkills.join(', ')}`
    );
  }
  // #307 behavior change: pi's auto-collected user/project skills are excluded
  // (noSkills). Agents that never set pi_settings.skills silently lose that
  // implicit set — surface the migration once per session creation.
  if (piSettings.skills === undefined || piSettings.skills === null) {
    console.warn(
      `[skills] agent ${agent.id} sets no pi_settings.skills — auto-collected skills are excluded since #307; add pi_settings.skills to enable library skills`
    );
  }
  const settingsManager = SettingsManager.inMemory({
    ...piSettings,
    skills: resolvedSkillPaths,
    defaultProjectTrust: 'always', // forced for headless
  });

  // 3. SessionManager — persist sessions per-agent
  const agentSessionDir = agent.id ? `${agentDir}/${agent.id}` : agentDir;
  const sessionDir = `${agentSessionDir}/sessions`;
  const { mkdirSync: _mkdir } = await import('node:fs');
  _mkdir(sessionDir, { recursive: true });
  const sessionManager = SessionManager.create(agentSessionDir, sessionDir);

  // 4. mem0 extension setup (#218): write config + ensure extension files
  if (mem0?.host && mem0?.apiKey) {
    writeMem0Config(agentSessionDir, {
      agentId: agent.id,
      runId: mem0.runId,
      host: mem0.host,
      apiKey: mem0.apiKey,
    });
    ensureMem0Extension(agentSessionDir);
  }

  // 5. ResourceLoader — inject systemPrompt + pick up skills/extensions from
  // settings. The StructuredOutput contract no longer injects response_format
  // (#320): pi never assembles it by itself, so the payload reaches the
  // provider with tools only — the customTool registered in step 6 is
  // serialized into the tools array by pi, and the model's answer arrives as
  // a toolCall (channel-separated from text, immune to the
  // response_format × tools mutual exclusion). Responses API providers still
  // get the store compat extension so tool loops survive LiteLLM/Azure
  // gateways (stateless function_call_output references are rejected there).
  //
  // noSkills + additionalSkillPaths: pi auto-collects user-level skills
  // (~/.agents/skills, ~/.pi/agent/skills) and project-level ones by default —
  // an agent must only see the skills explicitly enabled in its config (#307).
  // noSkills drops the auto-collected set; additionalSkillPaths re-injects the
  // resolved global-library paths as the sole source.
  const extensionFactories = [];
  if (structured) {
    // Restore the strict schema on the wire (the customTool's loose parameters
    // keep pi's uncapped pre-validation out of the retry loop — #320).
    extensionFactories.push(createStructuredOutputPayloadExtension(structured));
  }
  if (modelApi === 'openai-responses') {
    extensionFactories.push(
      createResponsesStoreCompatExtension({
        endpoint: provider.base_url,
        store: provider.responses_store,
      })
    );
  }
  // pi's buildSystemPrompt only emits promptGuidelines in its default-prompt
  // branch — with a customPrompt (agent system_prompt) the Guidelines section
  // is dropped, so the StructuredOutput MUST-call contract would never reach
  // the model. Append the guidelines to the system prompt directly when this
  // run carries a structured contract (verified on gpt-5.6-luna and
  // deepseek-v4-flash: without them the model answers translator prompts with
  // plain text instead of calling StructuredOutput).
  const systemPrompt = structured
    ? [config.system_prompt, ...STRUCTURED_OUTPUT_GUIDELINES].filter(Boolean).join('\n\n')
    : config.system_prompt || undefined;
  const resourceLoader = new DefaultResourceLoader({
    cwd: agentSessionDir,
    agentDir: agentSessionDir,
    settingsManager,
    systemPrompt,
    noThemes: true,
    noSkills: true,
    additionalSkillPaths: resolvedSkillPaths,
    extensionFactories,
  });
  await resourceLoader.reload();

  // 6. createAgentSession — full options. The StructuredOutput customTool is
  // registered per run when the node declares a contract: pi serializes it
  // into the provider payload tools and executes it on model calls (validate
  // → accept/terminate or field-level error feedback, retry capped at 5). The
  // factory closure captures THIS run's schema + attempt budget, so nothing
  // can leak across sessions (#248 acceptance, preserved in the tool route).
  const sessionOpts = {
    cwd: agentSessionDir,
    agentDir: agentSessionDir,
    modelRuntime,
    model: modelRuntime.getModel('custom', model),
    sessionManager,
    settingsManager,
    resourceLoader,
  };
  if (structured) {
    sessionOpts.customTools = [createStructuredOutputTool({ compiled: structured })];
  }

  // thinkingLevel
  if (sessionOptions.thinkingLevel) {
    sessionOpts.thinkingLevel = sessionOptions.thinkingLevel;
  }
  // Tool control
  if (sessionOptions.tools?.length) sessionOpts.tools = sessionOptions.tools;
  if (sessionOptions.excludeTools?.length) sessionOpts.excludeTools = sessionOptions.excludeTools;
  if (sessionOptions.noTools) sessionOpts.noTools = sessionOptions.noTools;

  const result = await createAgentSession(sessionOpts);

  // 7. Activate extension lifecycle (#218): fires session_start, enables
  //    before_agent_start (context injection) and agent_end (auto-capture).
  //    The onError binding records extension errors (e.g. an unrecognized
  //    provider payload shape in before_provider_request) on the session so
  //    the execution layer can classify them as capability errors instead of
  //    silently sending an unshaped request.
  await result.session.bindExtensions({
    mode: 'print',
    onError: (err) => {
      result.session._lastExtensionError = err;
    },
  });

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
    this.name = 'AgentExecutionError';
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
    skillsDir = null,
    createSession = createAgentSessionForAgent,
    runAgentExecution = defaultRunAgentExecution,
    resolveTimeoutMs: resolveTimeoutMsFn = resolveTimeoutMs,
    settingsProvider = null,
  }) {
    this.type = 'llm';
    this.db = db;
    this.agentDir = agentDir;
    this.skillsDir = skillsDir;
    this.createSession = createSession;
    this.runAgentExecution = runAgentExecution;
    this.resolveTimeoutMs = resolveTimeoutMsFn;
    this.settingsProvider = settingsProvider;
  }

  async execute(context) {
    const startedAt = new Date().toISOString();
    const { agentId, prompt } = context.inputs;
    if (!agentId) {
      throw new AgentExecutionError({ kind: 'agent_not_found', message: 'agentId is required' });
    }
    if (!prompt) {
      throw new AgentExecutionError({ kind: 'agent_not_found', message: 'prompt is required' });
    }

    const agent = getAgentById(this.db, agentId);
    if (!agent) {
      throw new AgentExecutionError({
        kind: 'agent_not_found',
        message: `agent not found: ${agentId}`,
      });
    }

    // Structured output contract (#248/#249): compile the node's declared
    // outputs schema once per run and hand it to session creation. FlowGram's
    // runtime moves `data.outputs` into node.declare.outputs (the `variable`
    // bag) and leaves only the remaining data fields in node.data — read the
    // declared schema first, fall back to data.outputs defensively. A malformed
    // declaration (e.g. hand-edited document) fails here, before any provider
    // request is sent, with a diagnosable structured_output_error.
    let structured = null;
    try {
      structured = compileStrictSchema(
        context.node?.declare?.outputs ?? context.node?.data?.outputs
      );
    } catch (err) {
      throw new AgentExecutionError({
        kind: 'structured_output_error',
        message: `invalid structured output schema: ${err?.message ?? String(err)}`,
      });
    }
    if (!structured) {
      throw new AgentExecutionError({
        kind: "structured_output_error",
        message: "structured output schema is required and must declare at least one field",
      });
    }

    // New interface: createSession(agent, agentDir, mem0?) — apiKey resolved internally
    // mem0 config: read from settings table + runId from workflowRunContext (#218)
    const mem0Host = this.db ? getMem0Host(this.db) : null;
    const mem0ApiKey = this.db ? getMem0ApiKey(this.db) : null;
    const mem0 =
      mem0Host && mem0ApiKey
        ? {
            host: mem0Host,
            apiKey: mem0ApiKey,
            runId: workflowRunContext.getStore()?.runId ?? null,
          }
        : undefined;
    const createSessionBound = (agentCfg, dir) =>
      this.createSession(agentCfg, dir, mem0, structured, this.skillsDir);

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
    const useTimeout = typeof timeoutMs === 'number' && timeoutMs > 0;

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
        ac.abort('node_timeout');
      }, timeoutMs);
    }

    try {
      const events = this.runAgentExecution({
        agentConfig: agent,
        prompt,
        signal: combinedSignal,
        createSession: createSessionBound,
        agentDir: this.agentDir,
        structured,
      });
      // Single consumer. The timer's ac.abort() triggers the shared module's
      // signal.aborted path, which yields a `cancelled` terminal — the loop
      // then exits naturally. No Promise.race needed (see impl note above).
      for await (const ev of events) {
        if (ev.type === 'terminal') {
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
        : new AgentExecutionError({
            kind: 'internal_error',
            message: err?.message ?? 'internal error',
          });
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
        kind: 'internal_error',
        message: 'Agent Execution ended without a terminal event',
      });
    }

    // Persist execution record (workflow_node trigger).
    try {
      const workflowRunId = workflowRunContext.getStore()?.runId ?? null;
      persistExecution(this.db, {
        agentId,
        status:
          timedOut && !workflowSignal?.aborted
            ? 'failed'
            : terminal.phase === 'succeeded'
            ? 'succeeded'
            : terminal.phase === 'cancelled'
            ? 'cancelled'
            : 'failed',
        triggerType: 'workflow_node',
        workflowRunId,
        sessionFile: terminal.sessionFile ?? null,
        startedAt,
        endedAt: new Date().toISOString(),
      });
    } catch (persistErr) {
      console.error('[runtime-adapter] persistExecution failed', persistErr);
    }

    // Phase 9 (#161/#66): timeout classification. If the per-node AbortController
    // fired (timedOut=true), the terminal is a `cancelled` from the shared
    // module's signal.aborted path — re-classify as a `failed` timeout per
    // #140 (timeout ≠ Cancellation). The workflow signal (user cancel) keeps
    // its `cancelled` projection (terminated:"cancelled") — #66 precedence.
    if (timedOut && ac?.signal.aborted && !workflowSignal?.aborted) {
      throw new AgentExecutionError({
        kind: 'timeout',
        message: `node timed out after ${timeoutMs}ms`,
        detail: {
          reason: 'node_timeout',
          partialText: terminal.partialText,
          toolEvents: terminal.toolEvents,
        },
      });
    }

    // Terminal projection — preserves #56 decision 2 (no thrown
    // CancellationError) + decision 6 (_executionDetail namespace).
    // With a structured contract (#249) the succeeded outputs are the
    // validated projection of declared fields only — `result` is NOT
    // synthesized; the raw final text stays in _executionDetail.finalText.
    switch (terminal.phase) {
      case 'succeeded':
        if (terminal.outputs) {
          return {
            outputs: {
              ...terminal.outputs,
              _executionDetail: {
                toolEvents: terminal.toolEvents,
                finalText: terminal.finalText,
              },
            },
          };
        }
        return {
          outputs: {
            result: terminal.partialText,
            _executionDetail: { toolEvents: terminal.toolEvents },
          },
        };
      case 'cancelled':
        return {
          outputs: {
            result: terminal.partialText,
            _executionDetail: { toolEvents: terminal.toolEvents, terminated: 'cancelled' },
          },
        };
      case 'failed':
        throw new AgentExecutionError(
          terminal.error ?? { kind: 'provider_error', message: 'Agent Execution failed' }
        );
      default:
        throw new AgentExecutionError({
          kind: 'internal_error',
          message: `unknown terminal phase: ${terminal.phase}`,
        });
    }
  }
}

export function createAgentExecutor(options) {
  return new AgentExecutor(options);
}

// --- FeishuBotExecutor: sends messages via Feishu bot API ---
class FeishuBotExecutor {
  constructor() {
    this.type = 'feishu-bot';
  }

  async execute(context) {
    const { inputs, node } = context;
    try {
      return await executeFeishuBot({ nodeData: node.data, inputs });
    } catch (err) {
      throw new AgentExecutionError({
        kind: 'provider_error',
        message: err?.message ?? 'Feishu bot execution failed',
      });
    }
  }
}

// --- Register the custom executors (must be called before any TaskRun) ---
export function initRuntime(db, agentDir, settingsProvider = null, skillsDir = null) {
  registerNodeExecutor(createAgentExecutor({ db, agentDir, settingsProvider, skillsDir }));
  registerNodeExecutor(new FeishuBotExecutor());
}

export { TaskRunAPI, TaskReportAPI, TaskCancelAPI, TaskValidateAPI, TaskResultAPI };
