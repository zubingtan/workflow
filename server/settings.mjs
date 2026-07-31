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
 * Return the full known-settings object for GET /api/settings.
 * Only known keys are included; absent keys appear as null.
 */
export function getKnownSettings(db) {
  return {
    node_timeout_default_ms: getNodeTimeoutDefaultMs(db),
    mem0_host: getSetting(db, "mem0_host"),
    mem0_api_key: getSetting(db, "mem0_api_key"),
  };
}

/**
 * Validate a settings PUT body. Returns {ok:true, value} on success or
 * {ok:false, error} on failure.
 *
 * Accepted keys (#212 D12):
 *   - node_timeout_default_ms: integer > 0, <= 24h (existing rule)
 *   - mem0_host: string, empty or an http(s) URL (self-hosted mem0 server)
 *   - mem0_api_key: string (may be empty to clear)
 *
 * At least one known key is required; unknown keys are rejected (fail-loud
 * so future additions are intentional, not accidental writes). Partial
 * updates are allowed — any subset of known keys may be sent.
 */
export function validateSettingsBody(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "body must be an object" };
  }
  const keys = Object.keys(body);
  if (keys.length === 0) {
    return { ok: false, error: "body must contain at least one setting" };
  }
  for (const k of keys) {
    if (!KNOWN_KEYS.includes(k)) {
      return { ok: false, error: `unknown setting key: ${k}` };
    }
  }

  const value = {};

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
    value.node_timeout_default_ms = v;
  }

  if ("mem0_host" in body) {
    const v = body.mem0_host;
    if (typeof v !== "string") {
      return { ok: false, error: "mem0_host must be a string" };
    }
    if (v !== "") {
      let url;
      try {
        url = new URL(v);
      } catch {
        return { ok: false, error: "mem0_host must be a valid URL" };
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, error: "mem0_host must be an http(s) URL" };
      }
    }
    value.mem0_host = v;
  }

  if ("mem0_api_key" in body) {
    const v = body.mem0_api_key;
    if (typeof v !== "string") {
      return { ok: false, error: "mem0_api_key must be a string" };
    }
    value.mem0_api_key = v;
  }

  return { ok: true, value };
}

export { KNOWN_KEYS };
