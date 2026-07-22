import { Agent } from "@earendil-works/pi-agent-core";
import { streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

/**
 * @typedef {Object} AgentBackend
 * @property {(listener: (event: import("@earendil-works/pi-agent-core").AgentEvent, signal: AbortSignal) => Promise<void> | void) => () => void} subscribe
 * @property {(input: string) => Promise<void>} prompt
 * @property {() => void} abort
 * @property {() => void} dispose
 * @property {import("@earendil-works/pi-agent-core").AgentState} state
 */

/**
 * @param {Object} options
 * @param {string} [options.systemPrompt]
 * @param {Array} [options.messages]
 * @param {Array} [options.tools]
 * @param {string} options.provider
 * @param {string} options.baseUrl
 * @param {string} options.apiKey
 * @param {string} options.model
 * @param {Object} [options.parameters]
 * @param {number} [options.timeoutMs]
 * @returns {AgentBackend}
 */
export function createPiBackend({
  systemPrompt = "",
  messages = [],
  tools = [],
  provider,
  baseUrl,
  apiKey,
  model: modelId,
  parameters = {},
  timeoutMs = 30_000,
}) {
  const model = {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: "off",
      tools,
      messages,
    },
    getApiKey: () => apiKey,
    streamFn: (streamModel, context, options) =>
      streamSimple(streamModel, context, {
        ...options,
        timeoutMs,
        maxRetries: 0,
      }),
    onPayload: (payload) => {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload))
        return payload;
      if (typeof parameters.temperature !== "number") return payload;
      return { ...payload, temperature: parameters.temperature };
    },
  });

  let disposed = false;

  return {
    subscribe: (listener) => agent.subscribe(listener),
    prompt: (input) => agent.prompt(input),
    abort: () => agent.abort(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      agent.abort();
    },
    get state() {
      return agent.state;
    },
  };
}
