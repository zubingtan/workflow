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

const KNOWN_KEYS = ["node_timeout_default_ms", "mem0_host", "mem0_api_key"];

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
 * Read node_timeout_default_ms as a number, or null if not set / unparseable.
 */
export function getNodeTimeoutDefaultMs(db) {
  const raw = getSetting(db, "node_timeout_default_ms");
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read mem0_host (URL string) or null if not set.
 */
export function getMem0Host(db) {
  return getSetting(db, "mem0_host");
}

/**
 * Read mem0_api_key (string) or null if not set.
 */
export function getMem0ApiKey(db) {
  return getSetting(db, "mem0_api_key");
}

/**
 * Return the full known-settings object for GET /api/settings.
 * Only known keys are included; absent keys appear as null.
 * Sensitive keys (mem0_api_key) are redacted — returns boolean (configured or not).
 */
export function getKnownSettings(db) {
  const mem0ApiKey = getMem0ApiKey(db);
  return {
    node_timeout_default_ms: getNodeTimeoutDefaultMs(db),
    mem0_host: getMem0Host(db),
    mem0_api_key: mem0ApiKey ? true : null, // redacted: only expose presence
  };
}

/**
 * Validate a settings PUT body. Returns {ok:true, value} on success or
 * {ok:false, error} on failure. Known keys are validated individually;
 * unknown keys are rejected (fail-loud so future additions are intentional).
 *
 * Validation rules:
 *   node_timeout_default_ms: Number.isInteger, > 0, <= 24h
 *   mem0_host: non-empty string (URL)
 *   mem0_api_key: non-empty string
 */
export function validateSettingsBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const keys = Object.keys(body);
  for (const k of keys) {
    if (!KNOWN_KEYS.includes(k)) {
      return { ok: false, error: `unknown setting key: ${k}` };
    }
  }
  if (keys.length === 0) {
    return { ok: false, error: "at least one setting key is required" };
  }

  const result = {};

  if ("node_timeout_default_ms" in body) {
    const v = body.node_timeout_default_ms;
    if (!Number.isInteger(v)) {
      return { ok: false, error: "node_timeout_default_ms must be an integer" };
    }
    if (v <= 0) {
      return { ok: false, error: "node_timeout_default_ms must be > 0" };
    }
    const MAX = 24 * 60 * 60 * 1000;
    if (v > MAX) {
      return { ok: false, error: `node_timeout_default_ms must be <= ${MAX} (24h)` };
    }
    result.node_timeout_default_ms = v;
  }

  if ("mem0_host" in body) {
    const v = body.mem0_host;
    if (typeof v !== "string" || v.trim().length === 0) {
      return { ok: false, error: "mem0_host must be a non-empty string" };
    }
    result.mem0_host = v.trim();
  }

  if ("mem0_api_key" in body) {
    const v = body.mem0_api_key;
    if (typeof v !== "string" || v.trim().length === 0) {
      return { ok: false, error: "mem0_api_key must be a non-empty string" };
    }
    result.mem0_api_key = v.trim();
  }

  return { ok: true, value: result };
}

export { KNOWN_KEYS };
