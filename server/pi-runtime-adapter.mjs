import { createPiBackend } from "./agent-backend.mjs";

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
  if (abort?.aborted) throw new ProviderRuntimeError("provider_timeout");

  const backend = createPiBackend({
    systemPrompt,
    messages,
    tools,
    provider,
    baseUrl,
    apiKey,
    model: modelId,
    parameters,
    timeoutMs,
  });

  const unsubscribe = events ? backend.subscribe(events) : undefined;
  const onAbort = () => backend.abort();
  abort?.addEventListener?.("abort", onAbort, { once: true });
  try {
    await backend.prompt(prompt);
    const message = backend.state.messages.findLast(
      (candidate) => candidate.role === "assistant",
    );
    if (!message || message.role !== "assistant")
      throw new Error("Pi did not return an assistant message");
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
    backend.dispose();
  }
}
