/**
 * Structured Output contract (#248/#249) — the schema side of the pi Agent
 * Node structured output pipeline.
 *
 * Owns:
 *   - compileStrictSchema: FlowGram IJsonSchema → strict provider schema
 *     (object, all properties required, additionalProperties:false,
 *     strict:true). Tolerates legacy documents that omit `required` — the
 *     property list itself is the contract (#246 normalization).
 *   - createStructuredOutputExtension: request-scoped inline extension that
 *     injects the schema into provider-native Structured Outputs payloads via
 *     before_provider_request (#243 decision: DefaultResourceLoader
 *     extensionFactories closure captures the per-run schema — inherently
 *     per-run isolated, no cross-session leakage).
 *   - StructuredOutputCapabilityError: fail-fast error raised BEFORE the
 *     provider request is sent, carrying provider/model/endpoint/API shape.
 *
 * Does NOT own: final-text extraction, JSON validation, retry/refusal
 * semantics — those live in the execution layer (server/agent-execution.mjs).
 */

// Correction/refusal retry prompts (#243). These are semantic nudges only —
// the schema injected via response_format is the structural guarantee.
const REFUSAL_RETRY_PROMPT =
  "Your previous response refused to answer. Please provide the requested structured output instead.";
const CORRECTION_PROMPT_PREFIX =
  "Your previous response did not match the required JSON schema. " +
  "Respond with ONLY valid JSON matching the schema. Errors: ";

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
 * Detect the provider request API shape from the outgoing payload.
 *   - OpenAI Chat Completions: has `messages`
 *   - OpenAI Responses: has `input` (and no `messages`)
 *   - anything else: unknown → capability error
 */
export function detectApiShape(payload) {
  if (!payload || typeof payload !== "object") return "unknown";
  if (Array.isArray(payload.messages)) return "openai-completions";
  if (Array.isArray(payload.input)) return "openai-responses";
  return "unknown";
}

/**
 * Create the inline extension factory for one run's structured schema.
 *
 * The factory is passed to DefaultResourceLoader.extensionFactories; the
 * loaded extension's `before_provider_request` handler rewrites the outgoing
 * provider payload. Because the factory closure captures THIS run's schema
 * and the resource loader is built per session (per run), schemas can never
 * leak across sessions (#248 acceptance).
 *
 * Injection per API shape:
 *   - openai-completions → response_format: { type:"json_schema", json_schema:{ name, strict:true, schema } }
 *   - openai-responses   → text: { format: { type:"json_schema", name, strict:true, schema } }
 *   - unknown            → StructuredOutputCapabilityError (fail fast, no fallback)
 *
 * @param {object} opts
 * @param {{ schema: object, name: string }} opts.compiled - compileStrictSchema result
 * @param {string} [opts.provider] - provider label for capability errors
 * @param {string} [opts.model] - model id for capability errors
 * @param {string} [opts.endpoint] - provider base_url for capability errors
 * @returns {(api: ExtensionAPI) => void} extension factory — the resource
 *   loader invokes it as `factory(api)` (loadExtensionFromFactory), so the
 *   returned function must REGISTER handlers, not return another function.
 */
export function createStructuredOutputExtension({ compiled, provider, model, endpoint }) {
  return (api) => {
    api.on("before_provider_request", (event) => {
      const payload = event.payload;
      const apiShape = detectApiShape(payload);
      if (apiShape === "openai-completions") {
        return {
          ...payload,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: compiled.name,
              strict: true,
              schema: compiled.schema,
            },
          },
        };
      }
      if (apiShape === "openai-responses") {
        return {
          ...payload,
          text: {
            ...(payload.text ?? {}),
            format: {
              type: "json_schema",
              name: compiled.name,
              strict: true,
              schema: compiled.schema,
            },
          },
        };
      }
      throw new StructuredOutputCapabilityError({
        provider,
        model,
        endpoint,
        apiShape,
        detail: "provider request shape does not expose a json_schema structured output slot",
      });
    });
  };
}

// --- Final-response extraction & strict validation (#249) ---

/**
 * Extract the final assistant message from the session's message list
 * (#243: the LAST assistant message at agent_end — never the accumulated
 * partialText, which is only a streaming projection).
 *
 * @param {object} session - pi AgentSession (duck-typed: `messages` getter)
 * @returns {{ text: string, stopReason: string|undefined, errorMessage: string|undefined }|null}
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
    };
  }
  return null;
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

/** Build the one-time correction prompt from field-level validation errors. */
export function buildCorrectionPrompt(errors) {
  return CORRECTION_PROMPT_PREFIX + errors.join("; ");
}

export { REFUSAL_RETRY_PROMPT };
