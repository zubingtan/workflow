/**
 * Phase 9 (#161): thin helper over the `settings` table (created in Phase 1's
 * ensureSchema). The table is a simple key/value store:
 *   settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)
 *
 * Only known keys are exposed via `getKnownSettings()` — this is the surface
 * GET /api/settings returns. Future settings extend KNOWN_KEYS + their getter.
 *
 * Values are stored as TEXT; numeric settings are parsed on read. `null` means
 * "not set" (fall back to the next precedence level, e.g. env var or default).
 */

const KNOWN_KEYS = [
  "node_timeout_default_ms",
  "mem0_host",
  "mem0_api_key",
  "mem0_admin_key",
  "mem0_llm_base_url",
  "mem0_llm_model",
  "mem0_embedder_model",
  "mem0_embedding_dims",
];

/**
 * Read a single setting value (raw TEXT). Returns null if the row is absent.
 */
export function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key);
  return row?.value ?? null;
}

/**
 * Upsert a setting (TEXT value). Caller is responsible for validation — this
 * helper just writes whatever string it's given.
 */
export function setSetting(db, key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value"
  ).run(key, String(value));
}

/**
 * Delete a setting row. No-op if the key doesn't exist.
 */
export function deleteSetting(db, key) {
  db.prepare("DELETE FROM settings WHERE key=?").run(key);
}

/**
 * Read node_timeout_default_ms as a number, or null if not set / unparseable.
 */
export function getNodeTimeoutDefaultMs(db) {
  const raw = getSetting(db, "node_timeout_default_ms");
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read mem0_host (a URL string), or null if not set.
 */
export function getMem0Host(db) {
  return getSetting(db, "mem0_host");
}

/**
 * Read mem0_api_key (a string), or null if not set.
 */
export function getMem0ApiKey(db) {
  return getSetting(db, "mem0_api_key");
}

/**
 * Read mem0_admin_key (a string) — used for admin-only mem0 endpoints
 * (POST /configure, DELETE /memories). Falls back to mem0_api_key when the
 * admin key is not set separately (single-key setup).
 */
export function getMem0AdminKey(db) {
  return getSetting(db, "mem0_admin_key") ?? getMem0ApiKey(db);
}

/** Read mem0_llm_base_url (OpenAI-compatible endpoint for the mem0 server's
 * internal LLM/embedder calls), or null if not set. */
export function getMem0LlmBaseUrl(db) {
  return getSetting(db, "mem0_llm_base_url");
}

/** Read mem0_llm_model, or null if not set. */
export function getMem0LlmModel(db) {
  return getSetting(db, "mem0_llm_model");
}

/** Read mem0_embedder_model, or null if not set. */
export function getMem0EmbedderModel(db) {
  return getSetting(db, "mem0_embedder_model");
}

/** Read mem0_embedding_dims as a number, or null if not set / unparseable. */
export function getMem0EmbeddingDims(db) {
  const raw = getSetting(db, "mem0_embedding_dims");
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Return the full known-settings object for GET /api/settings.
 * Only known keys are included; absent keys appear as null.
 */
export function getKnownSettings(db) {
  return {
    node_timeout_default_ms: getNodeTimeoutDefaultMs(db),
    mem0_host: getMem0Host(db),
    mem0_api_key: getMem0ApiKey(db),
    mem0_admin_key: getSetting(db, "mem0_admin_key"),
    mem0_llm_base_url: getMem0LlmBaseUrl(db),
    mem0_llm_model: getMem0LlmModel(db),
    mem0_embedder_model: getMem0EmbedderModel(db),
    mem0_embedding_dims: getMem0EmbeddingDims(db),
  };
}

/**
 * Validate a settings PUT body. Returns {ok:true, value} on success or
 * {ok:false, error} on failure. Accepts any subset of KNOWN_KEYS (partial
 * update); unknown keys are rejected (fail-loud so future additions are
 * intentional, not accidental writes).
 *
 * Validation rules:
 *   - node_timeout_default_ms: integer > 0, <= 24h (86400000ms), or null to clear
 *   - mem0_host: valid URL (http/https)
 *   - mem0_api_key: non-empty string
 *   - mem0_admin_key: non-empty string (optional; falls back to mem0_api_key)
 *   - mem0_llm_base_url: valid URL (http/https), optional
 *   - mem0_llm_model: non-empty string, optional
 *   - mem0_embedder_model: non-empty string, optional
 *   - mem0_embedding_dims: positive integer, optional
 */
export function validateSettingsBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return { ok: false, error: "at least one setting key is required" };
  }
  for (const k of keys) {
    if (!KNOWN_KEYS.includes(k)) {
      return { ok: false, error: `unknown setting key: ${k}` };
    }
  }
  const value = {};

  if ("node_timeout_default_ms" in body) {
    const v = body.node_timeout_default_ms;
    if (v === null) {
      value.node_timeout_default_ms = null; // signal to delete the setting row
    } else if (!Number.isInteger(v)) {
      return { ok: false, error: "node_timeout_default_ms must be an integer" };
    } else if (v <= 0) {
      return { ok: false, error: "node_timeout_default_ms must be > 0" };
    } else {
      const MAX = 24 * 60 * 60 * 1000;
      if (v > MAX) {
        return { ok: false, error: `node_timeout_default_ms must be <= ${MAX} (24h)` };
      }
      value.node_timeout_default_ms = v;
    }
  }

  if ("mem0_host" in body) {
    const v = body.mem0_host;
    if (v === null) {
      value.mem0_host = null; // signal to delete the setting row
    } else if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: "mem0_host must be a non-empty string" };
    } else {
      try {
        const url = new URL(v);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return { ok: false, error: "mem0_host must be a valid http(s) URL" };
        }
      } catch {
        return { ok: false, error: "mem0_host must be a valid URL" };
      }
      value.mem0_host = v;
    }
  }

  if ("mem0_api_key" in body) {
    const v = body.mem0_api_key;
    if (v === null) {
      value.mem0_api_key = null; // signal to delete the setting row
    } else if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: "mem0_api_key must be a non-empty string" };
    } else {
      value.mem0_api_key = v;
    }
  }

  if ("mem0_admin_key" in body) {
    const v = body.mem0_admin_key;
    if (v === null) {
      value.mem0_admin_key = null;
    } else if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: "mem0_admin_key must be a non-empty string" };
    } else {
      value.mem0_admin_key = v;
    }
  }

  if ("mem0_llm_base_url" in body) {
    const v = body.mem0_llm_base_url;
    if (v === null) {
      value.mem0_llm_base_url = null;
    } else if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: "mem0_llm_base_url must be a non-empty string" };
    } else {
      try {
        const url = new URL(v);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return { ok: false, error: "mem0_llm_base_url must be a valid http(s) URL" };
        }
      } catch {
        return { ok: false, error: "mem0_llm_base_url must be a valid URL" };
      }
      value.mem0_llm_base_url = v;
    }
  }

  if ("mem0_llm_model" in body) {
    const v = body.mem0_llm_model;
    if (v === null) {
      value.mem0_llm_model = null;
    } else if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: "mem0_llm_model must be a non-empty string" };
    } else {
      value.mem0_llm_model = v;
    }
  }

  if ("mem0_embedder_model" in body) {
    const v = body.mem0_embedder_model;
    if (v === null) {
      value.mem0_embedder_model = null;
    } else if (typeof v !== "string" || v.trim() === "") {
      return { ok: false, error: "mem0_embedder_model must be a non-empty string" };
    } else {
      value.mem0_embedder_model = v;
    }
  }

  if ("mem0_embedding_dims" in body) {
    const v = body.mem0_embedding_dims;
    if (v === null) {
      value.mem0_embedding_dims = null;
    } else if (!Number.isInteger(v) || v <= 0) {
      return { ok: false, error: "mem0_embedding_dims must be a positive integer" };
    } else {
      value.mem0_embedding_dims = v;
    }
  }

  return { ok: true, value };
}

export { KNOWN_KEYS };
