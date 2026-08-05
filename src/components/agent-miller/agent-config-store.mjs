/**
 * React-free Agent configuration seam.
 *
 * The editor sections send typed tab patches here. This module owns decoding,
 * recursive composition, provider fingerprints, and the per-Agent save queue.
 * Keeping it React-free makes the ordering and retry contract deterministic.
 */

export function parseAgentConfig(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function mergeAgentPatch(base = {}, patch = {}) {
  const result = { ...base };
  if (patch.name !== undefined) result.name = patch.name;
  if (patch.tags !== undefined)
    result.tags = Array.isArray(patch.tags) ? [...patch.tags] : patch.tags;
  if (patch.config !== undefined) {
    result.config = mergeConfigPatch(base.config ?? {}, patch.config);
  }
  return result;
}

export function mergeConfigPatch(base = {}, patch = {}) {
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeConfigPatch(result[key], value);
    } else if (Array.isArray(value)) {
      result[key] = [...value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function providerConnectionFingerprint(provider = {}) {
  return JSON.stringify({
    base_url: typeof provider.base_url === 'string' ? provider.base_url.trim() : '',
    api_key: typeof provider.api_key === 'string' ? provider.api_key.trim() : '',
    model: typeof provider.model === 'string' ? provider.model.trim() : '',
  });
}

export class AgentSaveCoordinator {
  /** @param {{save: (id: string, patch: object) => Promise<object>, delayMs?: number}} options */
  constructor({ save, delayMs = 600 } = {}) {
    if (typeof save !== 'function') throw new TypeError('save is required');
    this.save = save;
    this.delayMs = delayMs;
    this.drafts = new Map();
    this.pending = new Map();
    this.timers = new Map();
    this.inFlight = new Set();
    this.statuses = new Map();
    this.listeners = new Set();
  }

  seed(agent) {
    if (!agent?.id) return;
    if (!this.pending.has(agent.id) && !this.inFlight.has(agent.id)) {
      this.drafts.set(agent.id, {
        ...(agent.name !== undefined ? { name: agent.name } : {}),
        ...(agent.tags !== undefined ? { tags: parseTags(agent.tags) } : {}),
        config: parseAgentConfig(agent.config),
      });
    }
    if (!this.statuses.has(agent.id)) this.statuses.set(agent.id, { state: 'idle' });
    this.notify();
  }

  getDraft(id) {
    return this.drafts.get(id);
  }

  getConfig(id, fallback) {
    return this.drafts.get(id)?.config ?? parseAgentConfig(fallback);
  }

  getStatus(id) {
    return this.statuses.get(id) ?? { state: 'idle' };
  }

  update(id, patch) {
    const current = this.drafts.get(id) ?? { config: {} };
    const nextDraft = mergeAgentPatch(current, patch);
    this.drafts.set(id, nextDraft);
    this.pending.set(id, mergeAgentPatch(this.pending.get(id) ?? {}, patch));
    this.statuses.set(id, { state: 'pending' });
    this.schedule(id);
    this.notify();
    return nextDraft;
  }

  retry(id) {
    if (!this.pending.has(id) || this.inFlight.has(id)) return;
    this.statuses.set(id, { state: 'pending' });
    this.schedule(id);
    this.notify();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.listeners.clear();
  }

  schedule(id) {
    if (this.inFlight.has(id)) return;
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.flush(id);
      }, this.delayMs)
    );
  }

  async flush(id) {
    if (this.inFlight.has(id)) return;
    const patch = this.pending.get(id);
    if (!patch) return;
    this.pending.delete(id);
    this.inFlight.add(id);
    this.statuses.set(id, { state: 'saving' });
    this.notify();
    try {
      const saved = await this.save(id, patch);
      if (this.pending.has(id)) {
        // Keep the locally-composed draft; only the server acknowledgement for
        // the completed request is safe to use as a new baseline.
        this.statuses.set(id, { state: 'pending' });
      } else {
        this.drafts.set(id, {
          ...(saved.name !== undefined ? { name: saved.name } : {}),
          ...(saved.tags !== undefined ? { tags: parseTags(saved.tags) } : {}),
          config: parseAgentConfig(saved.config),
        });
        this.statuses.set(id, { state: 'saved' });
      }
    } catch (error) {
      this.pending.set(id, mergeAgentPatch(patch, this.pending.get(id) ?? {}));
      this.statuses.set(id, { state: 'error', message: error?.message ?? 'Save failed' });
    } finally {
      this.inFlight.delete(id);
      if (this.pending.has(id) && this.statuses.get(id)?.state === 'pending') this.schedule(id);
      this.notify();
    }
  }

  notify() {
    for (const listener of this.listeners) listener();
  }
}

function parseTags(raw) {
  if (Array.isArray(raw)) return [...raw];
  if (typeof raw !== 'string') return [];
  try {
    const tags = JSON.parse(raw);
    return Array.isArray(tags) ? tags : [];
  } catch {
    return [];
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
