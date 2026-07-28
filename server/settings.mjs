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

const KNOWN_KEYS = ["node_timeout_default_ms"];

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
  };
}

/**
 * Validate a settings PUT body. Returns {ok:true, value} on success or
 * {ok:false, error} on failure. Only `node_timeout_default_ms` is accepted
 * for now; unknown keys are rejected (fail-loud so future additions are
 * intentional, not accidental writes).
 *
 * Validation rules for node_timeout_default_ms:
 *   - Number.isInteger
 *   - > 0
 *   - <= 24 * 60 * 60 * 1000 (24h cap)
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
  if (!("node_timeout_default_ms" in body)) {
    return { ok: false, error: "node_timeout_default_ms is required" };
  }
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
  return { ok: true, value: { node_timeout_default_ms: v } };
}

export { KNOWN_KEYS };
