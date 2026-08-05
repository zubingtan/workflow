/**
 * OpenAI-compatible provider checks used by the Agent configuration editor.
 *
 * This module deliberately does not create an Agent Execution. Provider setup
 * must be safe to test: it fetches the model catalog and sends one fixed,
 * tool-free completion request.
 */

export class ProviderTestError extends Error {
  constructor(message, { code = 'provider_test_failed', status = 502 } = {}) {
    super(message);
    this.name = 'ProviderTestError';
    this.code = code;
    this.status = status;
  }
}

export async function fetchProviderModels(provider, options = {}) {
  const { baseUrl, apiKey } = resolveProvider(provider, { requireModel: false });
  const body = await requestJson(
    joinProviderUrl(baseUrl, 'models'),
    {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}` },
    },
    options
  );
  const items = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  const models = items.map(normalizeProviderModel).filter(Boolean);
  if (models.length === 0) {
    throw new ProviderTestError('Provider returned no models', { code: 'provider_models_empty' });
  }
  return { models };
}

export async function testProviderCompletion(provider, { models, ...options } = {}) {
  const { baseUrl, apiKey, model } = resolveProvider(provider, { requireModel: true });
  const modelIds = Array.isArray(models) ? models.map(getProviderModelId).filter(Boolean) : [];
  if (!modelIds.includes(model)) {
    throw new ProviderTestError(`Model ${model} was not returned by the provider model list`, {
      code: 'provider_model_not_found',
      status: 400,
    });
  }

  const body = await requestJson(
    joinProviderUrl(baseUrl, 'chat/completions'),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        stream: false,
      }),
    },
    options
  );

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new ProviderTestError('Provider returned an empty completion', {
      code: 'provider_empty_completion',
    });
  }
  return { ok: true, model };
}

/**
 * Convert provider-specific model records into the safe metadata surface used
 * by the Agent editor. Open WebUI records contain internal `info` fields,
 * access grants, and duplicate upstream objects; those are deliberately not
 * exposed to the browser or stored in the short-lived provider token.
 */
export function normalizeProviderModel(item) {
  const id = getProviderModelId(item);
  if (!id) return null;
  if (typeof item === 'string') return { id };

  const infoMeta = isPlainObject(item.info?.meta) ? item.info.meta : {};
  const model = { id };
  copyString(model, 'name', item.name);
  copyString(model, 'object', item.object);
  copyNumber(model, 'created', item.created);
  copyString(model, 'owned_by', item.owned_by);
  copyString(model, 'connection_type', item.connection_type);
  copyNullableNumber(model, 'max_input_tokens', item.max_input_tokens);
  copyNullableNumber(model, 'max_output_tokens', item.max_output_tokens);

  const description = firstString(infoMeta.description, item.description);
  if (description !== undefined) model.description = description;

  const capabilities = normalizePrimitiveRecord(infoMeta.capabilities ?? item.capabilities);
  if (Object.keys(capabilities).length > 0) model.capabilities = capabilities;

  const builtinTools = normalizePrimitiveRecord(infoMeta.builtinTools ?? item.builtin_tools);
  if (Object.keys(builtinTools).length > 0) model.builtin_tools = builtinTools;

  const filterIds = normalizeStringArray(infoMeta.filterIds ?? item.filter_ids);
  if (filterIds.length > 0) model.filter_ids = filterIds;

  const defaultFeatureIds = normalizeStringArray(
    infoMeta.defaultFeatureIds ?? item.default_feature_ids
  );
  if (defaultFeatureIds.length > 0) model.default_feature_ids = defaultFeatureIds;

  const tags = normalizeTags(item.tags ?? infoMeta.tags);
  if (tags.length > 0) model.tags = tags;

  return model;
}

function getProviderModelId(item) {
  if (typeof item === 'string') return item.trim();
  return typeof item?.id === 'string' ? item.id.trim() : '';
}

function copyString(target, key, value) {
  if (typeof value === 'string' && value.trim()) target[key] = value;
}

function copyNumber(target, key, value) {
  if (typeof value === 'number' && Number.isFinite(value)) target[key] = value;
}

function copyNullableNumber(target, key, value) {
  if (value === null) {
    target[key] = null;
    return;
  }
  copyNumber(target, key, value);
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim());
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((tag) => (typeof tag === 'string' ? tag : tag?.name))
    .filter((tag) => typeof tag === 'string' && tag.trim())
    .map((tag) => tag.trim());
}

function normalizePrimitiveRecord(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      ([, entry]) =>
        typeof entry === 'boolean' || typeof entry === 'string' || typeof entry === 'number'
    )
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function resolveProvider(provider, { requireModel }) {
  const baseUrl = typeof provider?.base_url === 'string' ? provider.base_url.trim() : '';
  const rawApiKey = typeof provider?.api_key === 'string' ? provider.api_key.trim() : '';
  const model = typeof provider?.model === 'string' ? provider.model.trim() : '';
  if (!baseUrl)
    throw new ProviderTestError('Provider base_url is required', {
      code: 'provider_invalid',
      status: 400,
    });
  if (!rawApiKey)
    throw new ProviderTestError('Provider api_key is required', {
      code: 'provider_invalid',
      status: 400,
    });
  if (requireModel && !model)
    throw new ProviderTestError('Provider model is required', {
      code: 'provider_invalid',
      status: 400,
    });

  let apiKey = rawApiKey;
  if (rawApiKey.startsWith('$')) {
    const envName = rawApiKey.slice(1);
    apiKey = process.env[envName] ?? '';
    if (!apiKey) {
      throw new ProviderTestError(`Provider API key environment variable ${envName} is not set`, {
        code: 'provider_api_key_missing',
        status: 400,
      });
    }
  }
  return { baseUrl, apiKey, model };
}

function joinProviderUrl(baseUrl, path) {
  try {
    return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
  } catch {
    throw new ProviderTestError('Provider base_url must be a valid URL', {
      code: 'provider_invalid_url',
      status: 400,
    });
  }
}

async function requestJson(url, init, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body?.error?.message ?? body?.error ?? `HTTP ${response.status}`;
      throw new ProviderTestError(`Provider request failed: ${detail}`, {
        code: 'provider_http_error',
        status: response.status,
      });
    }
    return body;
  } catch (error) {
    if (error instanceof ProviderTestError) throw error;
    if (error?.name === 'AbortError') {
      throw new ProviderTestError('Provider request timed out', {
        code: 'provider_timeout',
        status: 504,
      });
    }
    throw new ProviderTestError(`Provider request failed: ${error?.message ?? 'network error'}`);
  } finally {
    clearTimeout(timeout);
  }
}
