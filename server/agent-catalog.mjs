/**
 * Agent Catalog — the single owner of Agent SQL, validation, copy, and by-id
 * lookup (#55 decision).
 *
 * Replaces the 13+ scattered `db.prepare(...)` calls that were inline in
 * server/index.mjs route handlers. Every agents-table read/write goes through
 * this module. Routes keep only HTTP framing (parse body → call catalog →
 * shape response).
 *
 * Validation owned here (invariants the DB schema can't express):
 *   - temperature: finite number in [0, 2]; default 0.7 when undefined.
 * Both throw AgentCatalogError with a machine-readable `code`.
 */

import { nanoid } from "nanoid";

export class AgentCatalogError extends Error {
  constructor({ code, message }) {
    super(message);
    this.name = "AgentCatalogError";
    this.code = code;
  }
}

const AGENT_FIELDS = [
  "name",
  "provider_base_url",
  "provider_api_key",
  "model",
  "system_prompt",
  "temperature",
];

/**
 * Validate temperature. `undefined` is allowed (caller applies default).
 * Rejects non-numbers, NaN, and out-of-range values. Exported so routes
 * that don't write to the DB (e.g. /agents/test) can still enforce the
 * same invariant without duplicating the rule.
 */
export function validateTemperature(t) {
  if (t === undefined) return;
  if (typeof t !== "number" || Number.isNaN(t) || t < 0 || t > 2) {
    throw new AgentCatalogError({
      code: "invalid_temperature",
      message: `temperature must be a number in [0, 2], got ${String(t)}`,
    });
  }
}

/** Apply default temperature when undefined. Caller must have validated first. */
function normalizeTemperature(t) {
  return t ?? 0.7;
}

/** Validate and normalize a fields object for INSERT. */
function normalizeCreateFields(fields) {
  validateTemperature(fields.temperature);
  return {
    name: fields.name,
    provider_base_url: fields.provider_base_url,
    provider_api_key: fields.provider_api_key,
    model: fields.model,
    system_prompt: fields.system_prompt ?? "",
    temperature: normalizeTemperature(fields.temperature),
  };
}

const INSERT_SQL = `
  INSERT INTO agents (id, name, provider_base_url, provider_api_key, model, system_prompt, temperature)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

/** Insert a fully-formed row (7 columns in table order). */
function insertRow(db, row) {
  db.prepare(INSERT_SQL).run(
    row.id,
    row.name,
    row.provider_base_url,
    row.provider_api_key,
    row.model,
    row.system_prompt,
    row.temperature,
  );
}

export function createAgent(db, fields) {
  const norm = normalizeCreateFields(fields);
  const id = fields.id ?? nanoid(10);
  insertRow(db, { id, ...norm });
  return getAgentById(db, id);
}

export function listAgents(db) {
  return db.prepare("SELECT * FROM agents ORDER BY created_at DESC").all();
}

export function getAgentById(db, id) {
  return db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
}

export function updateAgent(db, id, fields) {
  const existing = getAgentById(db, id);
  if (!existing) return undefined;

  // Validate invariants for any field that's present.
  if (fields.temperature !== undefined) validateTemperature(fields.temperature);

  const updates = [];
  const values = [];
  for (const f of AGENT_FIELDS) {
    if (fields[f] !== undefined && fields[f] !== null) {
      updates.push(`${f} = ?`);
      values.push(fields[f]);
    }
  }
  if (updates.length === 0) return existing;
  updates.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE agents SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  return getAgentById(db, id);
}

export function deleteAgent(db, id) {
  const result = db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  return result.changes > 0;
}

export function copyAgent(db, id) {
  const src = getAgentById(db, id);
  if (!src) return undefined;
  const newId = nanoid(10);
  insertRow(db, {
    id: newId,
    name: `${src.name} (copy)`,
    provider_base_url: src.provider_base_url,
    provider_api_key: src.provider_api_key,
    model: src.model,
    system_prompt: src.system_prompt,
    temperature: src.temperature,
  });
  return getAgentById(db, newId);
}

/**
 * Seed an agent only if the table is empty. Returns the inserted row, or
 * undefined if the table was already non-empty (no-op). Used at server boot
 * to guarantee a fake-provider agent exists for first-run dev.
 */
export function seedAgentIfEmpty(db, fields) {
  const count = db.prepare("SELECT COUNT(*) as c FROM agents").get().c;
  if (count > 0) return undefined;
  return createAgent(db, fields);
}
