import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { SelfHostedMemoryClient } from './client.js';
import { loadConfig, resolveConfigPath } from './config/index.js';
import { detectRunId, resolveSearchFilters } from './memory/scoping.js';
import { formatMemoryList } from './memory/formatting.js';
import { registerMemoryTool } from './memory/tools.js';
import { setupAutoCapture } from './capture/index.js';
import { MEMORY_POLICY } from './prompt.js';
import { DREAM_PROTOCOL } from './dream/prompt.js';
import {
  incrementSessionCount,
  checkCheapGates,
  checkMemoryGate,
  acquireDreamLock,
  releaseDreamLock,
  recordDreamCompletion,
} from './dream/index.js';
import { captureEvent } from './telemetry.js';
import * as path from 'node:path';
import type { ScopeContext } from './types.js';

/**
 * Build the auto-recall context block: search memory with the user's prompt
 * and format top matches so they are guaranteed in context. Best-effort —
 * returns "" when disabled, prompt is blank, nothing matches, or search fails.
 */
export async function buildRecallContext(
  prompt: string,
  enabled: boolean,
  search: (query: string) => Promise<{ results?: unknown[] }>
): Promise<string> {
  if (!enabled) return '';
  const q = prompt.trim();
  if (!q) return '';
  try {
    const res = await search(q);
    const memories = (res.results ?? []) as Parameters<typeof formatMemoryList>[0];
    if (memories.length === 0) return '';
    return `<mem0-relevant-memories>\nRetrieved automatically for the current request. This is a shallow first pass — search mem0_memory for more if you need it.\n${formatMemoryList(
      memories
    )}\n</mem0-relevant-memories>`;
  } catch {
    return '';
  }
}

/**
 * Resolve the state directory for dream state/lock files.
 * Uses the config file's directory, falling back to cwd.
 */
function resolveStateDir(): string {
  const configPath = resolveConfigPath();
  if (configPath) return path.dirname(configPath);
  return process.cwd();
}

export default function mem0Extension(pi: ExtensionAPI): void {
  const config = loadConfig();

  if (!config.host) {
    console.warn(
      '[mem0] No host configured. Set MEM0_HOST or add host to mem0-config.json. Extension disabled.'
    );
    return;
  }

  const mem0 = new SelfHostedMemoryClient({
    host: config.host,
    apiKey: config.apiKey,
  });

  const scopeCtx: ScopeContext = {
    agentId: config.agentId,
    runId: 'unknown',
  };

  function getScopeCtx(): ScopeContext {
    return scopeCtx;
  }

  const stateDir = resolveStateDir();

  // ── Register tool + auto-capture ──────────────────────────────────────
  registerMemoryTool(pi, mem0, config, getScopeCtx);
  setupAutoCapture(pi, mem0, config, getScopeCtx);

  captureEvent('extension.registered', {
    auto_capture: config.autoCapture,
    dream_enabled: config.dream.enabled,
    default_scope: config.defaultScope,
  });

  // ── session_start: detect run ID, reconstruct scope ───────────────────
  pi.on('session_start', async (_event, ctx) => {
    const sessionFile = ctx.sessionManager?.getSessionFile?.();
    scopeCtx.runId = detectRunId(sessionFile);

    if (config.dream.enabled) {
      incrementSessionCount(stateDir, scopeCtx.runId);
    }

    captureEvent('session.start', {});
  });

  // ── before_agent_start: append memory policy + auto-recall + dream ────
  let dreamTriggered = false;
  let dreamChecked = false;

  pi.on('before_agent_start', async (event, _ctx) => {
    let extra = MEMORY_POLICY;

    // Guaranteed retrieval: prefetch memories relevant to this prompt
    const recall = await buildRecallContext(event.prompt ?? '', config.contextInjection, (q) =>
      mem0.search(q, {
        filters: resolveSearchFilters('agent', scopeCtx),
        threshold: config.searchThreshold,
      })
    );
    if (recall) extra += '\n\n' + recall;

    // Dream trigger (disabled by default in self-hosted)
    if (config.dream.enabled && config.dream.auto && !dreamTriggered && !dreamChecked) {
      const gates = checkCheapGates(stateDir, config.dream);
      if (gates.proceed) {
        try {
          const filters = resolveSearchFilters('agent', scopeCtx);
          const result = await mem0.getAll({ filters });
          const count = result.count ?? (result.results ?? []).length;
          dreamChecked = true;
          const memGate = checkMemoryGate(count, config.dream);

          if (memGate.pass && acquireDreamLock(stateDir)) {
            dreamTriggered = true;
            extra += '\n\n' + DREAM_PROTOCOL;
            captureEvent('dream.triggered', { memory_count: count });
          }
        } catch {
          // Transient error — retry next turn
        }
      }
    }

    return {
      systemPrompt: (event.systemPrompt ?? '') + '\n\n' + extra,
    };
  });

  // ── agent_end: dream completion check ─────────────────────────────────
  pi.on('agent_end', async (event) => {
    if (!dreamTriggered) return;

    const messages = event.messages ?? [];
    const hadWriteAction = messages.some((m) => {
      if (m.role !== 'assistant') return false;
      const content = Array.isArray(m.content) ? m.content : [];
      return content.some(
        (block: any) =>
          block.type === 'tool_use' &&
          block.name === 'mem0_memory' &&
          ['add', 'delete', 'delete_all'].includes(block.input?.action)
      );
    });

    if (hadWriteAction) {
      recordDreamCompletion(stateDir);
      captureEvent('dream.completed', {});
    }

    releaseDreamLock(stateDir);
    dreamTriggered = false;
  });

  // ── session_shutdown: release dream lock if still held ────────────────
  pi.on('session_shutdown', async () => {
    captureEvent('session.stop', {});
    if (dreamTriggered) {
      releaseDreamLock(stateDir);
      dreamTriggered = false;
    }
  });
}
