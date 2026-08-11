/**
 * Structured Output contract (#248/#249, tool route #320) — the schema side
 * of the pi Agent Node structured output pipeline.
 *
 * Owns:
 *   - compileStrictSchema: FlowGram IJsonSchema → strict provider schema
 *     (object, all properties required, additionalProperties:false,
 *     strict:true). Tolerates legacy documents that omit `required` — the
 *     property list itself is the contract (#246 normalization).
 *   - createStructuredOutputTool: the StructuredOutput customTool registered
 *     into the pi session (CreateAgentSessionOptions.customTools, #320). The
 *     compiled schema rides as the tool's `parameters` (pure JSON Schema — pi
 *     validates non-TypeBox schemas via its JSON-Schema path); execute()
 *     validates the model's arguments and either accepts (terminate:true, the
 *     agent loop stops) or feeds field-level errors back for the model to
 *     retry, capped at maxRetries.
 *   - StructuredOutputCapabilityError: fail-fast error raised BEFORE the
 *     provider request is sent, carrying provider/model/endpoint/API shape.
 *
 * Does NOT own: final extraction, strict validation, retry/refusal semantics —
 * extraction lives here too (extractFinalAssistantMessage) but the execution
 * layer (server/agent-execution.mjs) drives classification.
 */

// Correction/refusal retry prompts (#243). Refusal re-ask stays in the
// execution layer; schema correction is now the tool's job (#320), so the
// corrective prompt below is gone.
const REFUSAL_RETRY_PROMPT =
  "Your previous response refused to answer. Please provide the requested structured output instead.";

/** Flat primitive types allowed by the structured output contract (#242). */
export const ALLOWED_FIELD_TYPES = new Set(["string", "integer", "number", "boolean"]);

/**
 * Field-name rules mirrored from the UI editor (src/nodes/llm/schema-state.mjs
 * RESERVED_FIELD_NAMES + validateFields). The backend re-validates because a
 * hand-edited workflow document can bypass the editor — an invalid name here
 * would either pollute the prototype (`__proto__`), vanish from the compiled
 * schema (`constructor`, ...), or break node-id.field downstream references
 * (dots). Keep this list in sync with the UI.
 */
const RESERVED_FIELD_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "_executionDetail",
]);

/** @returns {string|null} an error message when the name is invalid. */
function validateFieldName(key) {
  if (typeof key !== "string" || key.length === 0) return "Field name cannot be empty";
  if (RESERVED_FIELD_NAMES.has(key)) return `"${key}" is a reserved name`;
  if (/[\u4e00-\u9fff]/.test(key)) return "Chinese characters are not allowed";
  if (key.includes(".")) return "Dots (.) are not allowed";
  if (/[\x00-\x1f]/.test(key)) return "Control characters are not allowed";
  return null;
}

/**
 * Capability error: raised when the provider/API shape cannot honor the
 * structured output contract. Never falls back to json_object or plain text.
 * `apiShape` is the request API family ("openai-completions" |
 * "openai-responses" | "unknown").
 */
export class StructuredOutputCapabilityError extends Error {
  constructor({ provider, model, endpoint, apiShape, detail = "" }) {
    const message = [
      `Structured output not supported: provider=${provider || "unknown"}`,
      `model=${model || "unknown"}`,
      `endpoint=${endpoint || "unknown"}`,
      `api=${apiShape || "unknown"}`,
      detail ? ` (${detail})` : "",
    ].join(" ");
    super(message);
    this.name = "StructuredOutputCapabilityError";
    this.kind = "capability_error";
    this.provider = provider;
    this.model = model;
    this.endpoint = endpoint;
    this.apiShape = apiShape;
  }
}

/**
 * Compile a FlowGram IJsonSchema `outputs` declaration into the strict
 * provider-native schema required by Structured Outputs:
 *
 *   { type:"object", required:[...all property keys], additionalProperties:false,
 *     properties:{ key:{ type } } }
 *
 * Legacy documents may omit `required` or `additionalProperties` — the
 * property list is the contract (#246: normalization happens at compile
 * time, not per-run). Fields with non-primitive types are rejected.
 *
 * @param {object|undefined} outputs - node.data.outputs (FlowGram IJsonSchema)
 * @returns {{ schema: object, name: string }|null} null when there is no
 *   structured contract (absent outputs or an empty/unsupported declaration).
 * @throws {Error} when the declaration exists but cannot be honored
 *   (non-object shape, nested types, non-primitive fields).
 */
export function compileStrictSchema(outputs) {
  if (outputs === undefined || outputs === null) return null;
  if (typeof outputs !== "object") {
    throw new Error("Structured output schema must be an object");
  }
  if (outputs.type !== "object") {
    throw new Error(`Structured output schema must be type "object", got "${outputs.type}"`);
  }
  const properties = outputs.properties ?? {};
  const keys = Object.keys(properties);
  if (keys.length === 0) return null; // no declared fields → no structured contract

  const compiledProperties = {};
  for (const key of keys) {
    const nameError = validateFieldName(key);
    if (nameError) {
      throw new Error(`Invalid structured output field name: ${nameError}`);
    }
    const field = properties[key];
    if (!field || typeof field !== "object") {
      throw new Error(`Field "${key}" must be an object with a primitive type`);
    }
    const type = field.type;
    if (!ALLOWED_FIELD_TYPES.has(type)) {
      throw new Error(`Field "${key}" has unsupported type "${type}" (allowed: string/integer/number/boolean)`);
    }
    // Integer must be a distinct primitive in the provider schema — reuse the
    // FlowGram declaration verbatim (no coercion, no extra constraints).
    compiledProperties[key] = {
      type,
      ...(typeof field.description === "string" ? { description: field.description } : {}),
    };
  }

  return {
    name: "workflow_agent_outputs",
    schema: {
      type: "object",
      required: keys,
      additionalProperties: false,
      properties: compiledProperties,
    },
  };
}

/**
 * The protocol-level MUST-call contract (#320). pi's buildSystemPrompt injects
 * promptGuidelines into the system prompt's Guidelines section ONLY in its
 * default-prompt branch — when a customPrompt (agent system_prompt) is set,
 * the guidelines are dropped entirely, so the model never sees the contract.
 * The session factory therefore appends these to the system prompt directly
 * when a run carries a structured contract (see runtime-adapter.mjs).
 * `tool_choice` forced is unavailable on DashScope models (400, thinking
 * mode), so the prompt + validation-retry loop is the enforcement mechanism.
 */
export const STRUCTURED_OUTPUT_GUIDELINES = [
  "You MUST call the StructuredOutput tool exactly once to return your final answer. The tool's input schema defines the required shape.",
  "Do your work, then call StructuredOutput with your answer.",
  "Do NOT put your answer in a text response. The workflow reads ONLY the StructuredOutput tool call.",
  "Even if a tool result or skill instructs you to reply directly, you MUST still call StructuredOutput with your final answer.",
  "If validation fails, read the error and call StructuredOutput again with a corrected shape.",
];

/**
 * Create the StructuredOutput customTool (#320, Qoder `agent({schema})`
 * mechanism). Registered into CreateAgentSessionOptions.customTools so pi:
 *   - serializes its definition into the provider payload `tools` array,
 *   - executes it when the model calls it: validate the arguments; accept with
 *     terminate:true on success; otherwise return field-level errors as the
 *     tool result so the pi agent loop feeds them back and the model retries
 *     (capped at maxRetries, then terminate so the run ends fail-fast).
 *
 * `parameters` is deliberately LOOSE ({type:"object"}): pi's own
 * validateToolArguments runs BEFORE execute and would reject strict-schema
 * violations with an uncapped error-feedback loop (pi's agent loop has no
 * retry cap). All strict validation therefore lives in execute — which owns
 * the capped retry — while the STRICT compiled schema is restored on the
 * wire by createStructuredOutputPayloadExtension so the model still sees the
 * full contract.
 *
 * The attempt counter lives in the factory closure, so every session (every
 * run) gets its own budget — schemas and counters can never leak across runs
 * (#248 per-run isolation, preserved in the tool route).
 *
 * @param {object} opts
 * @param {{ schema: object, name: string }} opts.compiled - compileStrictSchema result
 * @param {number} [opts.maxRetries=5] - validation-failure retry cap
 * @returns {object} pi ToolDefinition (duck-typed: name/label/description/
 *   promptGuidelines/parameters/execute)
 */
export function createStructuredOutputTool({ compiled, maxRetries = 5 }) {
  let attempts = 0;
  return {
    name: "StructuredOutput",
    label: "Structured Output",
    description:
      "Return the structured output requested by the workflow. You MUST call this tool exactly once successfully. If validation fails, call again with corrected shape.",
    // The MUST-call contract lives in STRUCTURED_OUTPUT_GUIDELINES — see the
    // constant doc comment for why the session factory also injects it into
    // the system prompt.
    promptGuidelines: STRUCTURED_OUTPUT_GUIDELINES,
    // Loose on purpose — see the module doc comment above.
    parameters: { type: "object" },
    execute: async (toolCallId, params) => {
      attempts += 1;
      const result = validateStructuredOutput(params, compiled);
      if (result.ok) {
        return {
          content: [{ type: "text", text: "Structured output accepted." }],
          details: { ok: true, outputs: result.outputs },
          terminate: true,
        };
      }
      const errorText =
        `StructuredOutput validation failed: ${result.errors.join("; ")}. ` +
        "Call the tool again with corrected arguments matching the schema.";
      if (attempts >= maxRetries) {
        return {
          content: [{ type: "text", text: `${errorText} Retry cap (${maxRetries}) exceeded.` }],
          details: { ok: false, errors: result.errors },
          terminate: true,
        };
      }
      return {
        content: [{ type: "text", text: errorText }],
        details: { ok: false, errors: result.errors },
      };
    },
  };
}

/**
 * Create the request-scoped inline extension that restores the STRICT compiled
 * schema on the wire (#320). pi serializes the customTool's loose parameters
 * ({type:"object"}) into the provider payload tools; this handler replaces the
 * StructuredOutput tool's parameters with compiled.schema (all required,
 * additionalProperties:false) so the model still sees the full contract while
 * pi's uncapped pre-validation stays out of the loop.
 *
 * Works for both API shapes: completions (tool.function.parameters) and
 * responses (tool.parameters). Factory closure captures THIS run's schema
 * (per-run isolation, same pattern as the old response_format extension).
 *
 * @param {{ schema: object, name: string }} compiled - compileStrictSchema result
 * @returns {(api: ExtensionAPI) => void} extension factory
 */
export function createStructuredOutputPayloadExtension(compiled) {
  return (api) => {
    api.on("before_provider_request", (event) => {
      const payload = event.payload;
      if (!payload || !Array.isArray(payload.tools)) return;
      let changed = false;
      const tools = payload.tools.map((tool) => {
        if (tool?.function?.name === "StructuredOutput") {
          changed = true;
          return { ...tool, function: { ...tool.function, parameters: compiled.schema } };
        }
        if (tool?.name === "StructuredOutput") {
          changed = true;
          return { ...tool, parameters: compiled.schema };
        }
        return tool;
      });
      if (!changed) return;
      return { ...payload, tools };
    });
  };
}

// --- Final-response extraction & strict validation (#249) ---

/**
 * Extract the final assistant message from the session's message list
 * (#243: the LAST assistant message at agent_end — never the accumulated
 * partialText, which is only a streaming projection).
 *
 * Since #320 the message may carry toolCall blocks (the StructuredOutput
 * route); the LAST toolCall block (pi parses arguments into an object) is
 * surfaced as `toolCall` so the execution layer can classify the run.
 *
 * @param {object} session - pi AgentSession (duck-typed: `messages` getter)
 * @returns {{ text: string, stopReason: string|undefined, errorMessage: string|undefined,
 *             toolCall: { name: string, arguments: object }|null }|null}
 *   null when the session has no assistant message at all.
 */
export function extractFinalAssistantMessage(session) {
  const messages = session?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    return {
      text: extractTextContent(msg),
      stopReason: msg.stopReason,
      errorMessage: msg.errorMessage,
      toolCall: extractToolCall(msg),
    };
  }
  return null;
}

/**
 * Extract the LAST StructuredOutput toolCall block from an assistant message's
 * content. Other toolCall blocks (e.g. read_file in a mixed batch) never
 * overwrite an already-found StructuredOutput candidate — the classification
 * layer must never mistake them for the contract channel.
 */
function extractToolCall(msg) {
  const content = msg.content;
  if (!Array.isArray(content)) return null;
  let last = null;
  for (const part of content) {
    if (part?.type === "toolCall" && part.name === "StructuredOutput") {
      last = { name: part.name, arguments: part.arguments };
    }
  }
  return last;
}

/** Concatenate the text parts of an assistant message (any content shape). */
function extractTextContent(msg) {
  const content = msg.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

/** Refusal detection (#243: provider refusal surfaces as stopReason error + refusal text). */
export function isRefusalMessage(msg) {
  if (!msg) return false;
  if (msg.stopReason === "error" && /refus/i.test(msg.errorMessage ?? "")) return true;
  // Some providers put the refusal wording in the text itself with a
  // content_filter-style stop reason; the errorMessage form is the canonical
  // pi-ai mapping (finish_reason → errorMessage), so this stays conservative.
  return false;
}

/** Incomplete / max-token truncation (#249: incomplete fails, no coercion). */
export function isIncompleteMessage(msg) {
  return msg?.stopReason === "length";
}

/**
 * Strictly validate a parsed JSON value against the compiled schema.
 * No coercion, no hidden fields, exact primitive types only.
 *
 * Uses Object.hasOwn for membership so prototype-chain keys like
 * `constructor`/`toString` can never bypass the extra/missing field checks.
 *
 * @param {unknown} parsed - JSON.parse result
 * @param {{ schema: { properties: Record<string, {type: string}> } }} compiled
 * @returns {{ ok: true, outputs: Record<string, unknown> } | { ok: false, errors: string[] }}
 */
export function validateStructuredOutput(parsed, compiled) {
  const properties = compiled.schema.properties;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, errors: ["response must be a JSON object"] };
  }

  const errors = [];
  const outputs = {};
  const parsedKeys = Object.keys(parsed);
  const declaredKeys = Object.keys(properties);

  // Single pass over the union of declared and present keys: missing,
  // extra, and type checks are decided together.
  for (const key of declaredKeys) {
    if (!Object.hasOwn(parsed, key)) {
      errors.push(`missing required field "${key}"`);
      continue;
    }
    const expected = properties[key].type;
    const value = parsed[key];
    const matches =
      expected === "string"
        ? typeof value === "string"
        : expected === "integer"
          ? typeof value === "number" && Number.isInteger(value)
          : expected === "number"
            ? typeof value === "number"
            : expected === "boolean"
              ? typeof value === "boolean"
              : false;
    if (!matches) {
      errors.push(`field "${key}" must be ${expected}, got ${jsonTypeName(value)}`);
      continue;
    }
    outputs[key] = value;
  }
  for (const key of parsedKeys) {
    if (!Object.hasOwn(properties, key)) {
      errors.push(`unexpected extra field "${key}"`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, outputs };
}

/** Human-readable JSON type name for validation messages. */
function jsonTypeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export { REFUSAL_RETRY_PROMPT };