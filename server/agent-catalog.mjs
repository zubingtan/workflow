/**
 * Agent Catalog — the single owner of Agent SQL, validation, copy, and by-id
 * lookup.
 *
 * Schema (post-refactor #213):
 *   agents(id, name, runtime, config JSON, tags JSON, created_at, updated_at)
 *
 * Config JSON has three layers:
 *   - provider: {base_url, api_key, model, pricing?}
 *   - system_prompt: string
 *   - session_options: {thinkingLevel?, tools?, excludeTools?, noTools?}
 *   - pi_settings: {defaultProjectTrust, retry?, compaction?, skills?, ...}
 */

import { nanoid } from 'nanoid';

export class AgentCatalogError extends Error {
  constructor({ code, message }) {
    super(message);
    this.name = 'AgentCatalogError';
    this.code = code;
  }
}

const DEFAULT_CONFIG = {
  provider: { base_url: '', api_key: '', model: '' },
  system_prompt: '',
  session_options: {},
  pi_settings: { defaultProjectTrust: 'always' },
};

export function createAgent(db, fields) {
  const id = fields.id ?? nanoid(10);
  let name = fields.name || 'Untitled';
  // Auto-increment "Untitled" → "Untitled 2" → "Untitled 3" etc. when the
  // base name already exists (matches macOS Finder duplicate naming).
  if (!fields.name) {
    const existing = db
      .prepare('SELECT name FROM agents WHERE name = ? OR name LIKE ?')
      .all(name, `${name} %`);
    if (existing.length > 0) {
      let suffix = 2;
      const nameSet = new Set(existing.map((r) => r.name));
      while (nameSet.has(`${name} ${suffix}`)) suffix++;
      name = `${name} ${suffix}`;
    }
  }
  const runtime = fields.runtime || 'pi-coding-agent';
  const config = JSON.stringify(fields.config ?? DEFAULT_CONFIG);
  const tags = JSON.stringify(fields.tags ?? []);
  db.prepare('INSERT INTO agents (id, name, runtime, config, tags) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    runtime,
    config,
    tags
  );
  return getAgentById(db, id);
}

export function listAgents(db) {
  return db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
}

export function getAgentById(db, id) {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
}

/**
 * Partial update. Supports:
 * - name: string
 * - config: object (recursively merged with existing config)
 * - tags: array (replaced)
 */
export function updateAgent(db, id, fields) {
  const existing = getAgentById(db, id);
  if (!existing) return undefined;

  const updates = [];
  const values = [];

  if (fields.name !== undefined) {
    updates.push('name = ?');
    values.push(fields.name);
  }
  if (fields.config !== undefined) {
    const merged = deepMergeConfig(JSON.parse(existing.config), fields.config);
    updates.push('config = ?');
    values.push(JSON.stringify(merged));
  }
  if (fields.tags !== undefined) {
    updates.push('tags = ?');
    values.push(JSON.stringify(fields.tags));
  }

  if (updates.length === 0) return existing;
  updates.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return getAgentById(db, id);
}

/**
 * Delete agent. Returns {deleted: true} or throws AgentCatalogError with
 * code 'workflow_reference' if workflows reference this agent.
 */
export function deleteAgent(db, id) {
  // Check workflow references
  const workflows = db.prepare('SELECT id, name, data FROM workflows').all();
  const referencing = workflows.filter((w) => {
    try {
      const data = JSON.parse(w.data);
      const nodes = data.nodes || [];
      return nodes.some(
        (n) =>
          n?.data?.inputsValues?.agentId?.content === id ||
          n?.data?.agentId === id ||
          n?.data?.agent_id === id
      );
    } catch {
      return false;
    }
  });
  if (referencing.length > 0) {
    throw new AgentCatalogError({
      code: 'workflow_reference',
      message: `Agent is referenced by ${referencing.length} workflow(s): ${referencing
        .map((w) => w.name)
        .join(', ')}`,
    });
  }
  // Delete execution history first (FK constraint: agent_executions.agent_id
  // REFERENCES agents(id) without ON DELETE CASCADE).
  db.prepare('DELETE FROM agent_executions WHERE agent_id = ?').run(id);
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(id);
  return result.changes > 0;
}

export function copyAgent(db, id) {
  const src = getAgentById(db, id);
  if (!src) return undefined;
  const newId = nanoid(10);
  db.prepare('INSERT INTO agents (id, name, runtime, config, tags) VALUES (?, ?, ?, ?, ?)').run(
    newId,
    `${src.name} (copy)`,
    src.runtime,
    src.config,
    src.tags
  );
  return getAgentById(db, newId);
}

/**
 * Seed an agent only if the table is empty. Returns the inserted row, or
 * undefined if the table was already non-empty (no-op).
 */
export function seedAgentIfEmpty(db, fields) {
  const count = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
  if (count > 0) return undefined;
  return createAgent(db, fields);
}

/**
 * Recursively merge a config patch while preserving fields unknown to the
 * editor. Arrays are values (the caller replaces the whole array) and null is
 * an explicit value used to clear an optional setting.
 */
function deepMergeConfig(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;

  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMergeConfig(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
