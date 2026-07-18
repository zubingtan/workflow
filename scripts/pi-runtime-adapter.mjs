import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";

const providerFailures = {
  provider_auth_failed: "Provider authentication failed",
  provider_timeout: "Provider request timed out",
  provider_empty_output: "Provider returned empty output",
};

export class ProviderRuntimeError extends Error {
  constructor(code) {
    super(providerFailures[code]);
    this.name = "ProviderRuntimeError";
    this.code = code;
  }
}

function providerError(message) {
  if (/(^|\D)(401|403)(\D|$)/.test(message)) {
    return new ProviderRuntimeError("provider_auth_failed");
  }
  if (/timed out/i.test(message)) {
    return new ProviderRuntimeError("provider_timeout");
  }
  return new Error("Provider request failed");
}

export async function runPiAgent({
  prompt,
  systemPrompt = "",
  messages = [],
  tools = [],
  events,
  abort,
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
    streamFn: (streamModel, context, options) => streamSimple(streamModel, context, {
      ...options,
      timeoutMs,
      maxRetries: 0,
    }),
    onPayload: (payload) => {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
      if (typeof parameters.temperature !== "number") return payload;
      return { ...payload, temperature: parameters.temperature };
    },
  });

  if (abort?.aborted) throw new ProviderRuntimeError("provider_timeout");
  const unsubscribe = events ? agent.subscribe(events) : undefined;
  const onAbort = () => agent.abort();
  abort?.addEventListener?.("abort", onAbort, { once: true });
  try {
    await agent.prompt(prompt);
    const message = agent.state.messages.findLast((candidate) => candidate.role === "assistant");
    if (!message || message.role !== "assistant") throw new Error("Pi did not return an assistant message");
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      throw providerError(message.errorMessage ?? "");
    }
    const output = message.content
      .filter((content) => content.type === "text")
      .map((content) => content.text)
      .join("");
    if (output.trim().length === 0) throw new ProviderRuntimeError("provider_empty_output");
    return output;
  } finally {
    abort?.removeEventListener?.("abort", onAbort);
    unsubscribe?.();
  }
}
