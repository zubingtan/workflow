import { Agent } from "@mariozechner/pi-agent-core";

export async function runPiAgent({ prompt, provider, baseUrl, apiKey, model: modelId, parameters }) {
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
      systemPrompt: "",
      model,
      thinkingLevel: "off",
      tools: [],
      messages: [],
    },
    getApiKey: () => apiKey,
    onPayload: (payload) => {
      if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return payload;
      if (typeof parameters.temperature !== "number") return payload;
      return { ...payload, temperature: parameters.temperature };
    },
  });

  await agent.prompt(prompt);
  const message = agent.state.messages.findLast((candidate) => candidate.role === "assistant");
  if (!message || message.role !== "assistant") throw new Error("Pi did not return an assistant message");
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error("Pi model call did not complete");
  }
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("");
}
