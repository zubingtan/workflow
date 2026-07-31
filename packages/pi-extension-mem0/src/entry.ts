import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadConfig, CONFIG_DIR } from './config/index.ts';
import { resolveSearchFilters } from './memory/scoping.ts';
import { formatMemoryList } from './memory/formatting.ts';
import { registerMemoryTool } from './memory/tools.ts';
import { registerCommands } from './commands.ts';
import { setupAutoCapture } from './capture/index.ts';
import { SelfHostedMemoryClient } from './client.ts';
import { MEMORY_POLICY } from './prompt.ts';
import { DREAM_PROTOCOL } from './dream/prompt.ts';
import {
  incrementSessionCount,
  checkCheapGates,
  checkMemoryGate,
  acquireDreamLock,
  releaseDreamLock,
  recordDreamCompletion,
} from './dream/index.ts';
import { captureEvent } from './telemetry.ts';
import type { ScopeContext } from './types.ts';

/**
 * Build the auto-recall context block for a turn: search memory with the user's
 * prompt and format the top matches so they are guaranteed in context instead of
 * relying on the agent to call the tool. Best-effort — returns "" when disabled,
 * the prompt is blank, nothing matches, or the search fails; it must never block
 * the turn (D7/D10).
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
 * A typed minimal surface for the memory client so tools/capture stay
 * client-agnostic. In self-hosted mode (the only mode in this fork) it wraps
 * SelfHostedMemoryClient.
 */
export type MemoryClientLike = Pick<
  SelfHostedMemoryClient,
  'add' | 'search' | 'getAll' | 'update' | 'delete' | 'deleteAll'
>;

export default function mem0Extension(pi: ExtensionAPI): void {
  // D4: config is loaded at activation (MEM0_CONFIG_PATH / legacy path) and
  // reloaded on session_start from {agentDir}/mem0-config.json — the workflow
  // backend writes that file before every run with fresh host/apiKey/agentId/
  // runId. session_start fires right after session creation, so the reload
  // always sees the current run's config.
  let config = loadConfig();

  function makeClient(cfg: typeof config): MemoryClientLike | null {
    if (!cfg.host || !cfg.apiKey) return null;
    return new SelfHostedMemoryClient({ host: cfg.host, apiKey: cfg.apiKey });
  }

  let mem0 = makeClient(config);

  // D3 identity: agentId is the isolation dimension; runId is provenance.
  const scopeCtx: ScopeContext = {
    agentId: config.agentId,
    runId: config.runId,
  };

  function getScopeCtx(): ScopeContext {
    return scopeCtx;
  }

  const telemetryCtx = { apiKey: config.apiKey };

  // D10 graceful degradation: without a configured mem0 server the extension
  // registers nothing and stays inert — agent execution is unaffected. The
  // config is reloaded per run on session_start (D4, from {agentDir}/
  // mem0-config.json), so a missing config at activation time must NOT
  // disable the session_start hook — registration is deferred until a run
  // actually provides host/apiKey.
  let registered = false;
  function ensureRegistered() {
    if (registered || !mem0) return;
    registerMemoryTool(pi, mem0, config, getScopeCtx, telemetryCtx);
    registerCommands(pi, mem0, config, getScopeCtx, telemetryCtx);
    setupAutoCapture(pi, mem0, config, getScopeCtx, telemetryCtx);
    registered = true;
    captureEvent(
      'pi.plugin.registered',
      {
        auto_capture: config.autoCapture,
        dream_enabled: config.dream.enabled,
        default_scope: config.defaultScope,
      },
      telemetryCtx
    );
  }
  if (!mem0) {
    console.warn(
      '[mem0] No self-hosted mem0 configured at activation; will retry on session_start.'
    );
  }

  // ── session_start: reload per-run config (D4) + reconstruct scope ────
  pi.on('session_start', async (_event, ctx) => {
    const fresh = loadConfig(ctx.cwd);
    if (fresh.host || fresh.apiKey || fresh.agentId) {
      config = fresh;
      mem0 = makeClient(config);
      scopeCtx.agentId = config.agentId;
      scopeCtx.runId = config.runId;
      telemetryCtx.apiKey = config.apiKey;
    }
    ensureRegistered();

    if (config.dream.enabled) {
      incrementSessionCount(CONFIG_DIR, scopeCtx.runId);
    }

    captureEvent('pi.session.start', {}, telemetryCtx);
  });

  // ── before_agent_start: memory policy + guaranteed recall (D7) ───────
  let dreamTriggered = false;
  let dreamChecked = false;

  pi.on('before_agent_start', async (event, _ctx) => {
    // D10: without a working client the turn proceeds unchanged.
    if (!mem0) return { systemPrompt: event.systemPrompt };
    let extra = MEMORY_POLICY;

    // Guaranteed retrieval: prefetch memories relevant to this prompt so the
    // agent always has them, rather than depending on it to call the tool.
    // D3: search is scoped to the agent (not the run) so memories persist
    // across runs. Best-effort: any failure returns "" (D10).
    const recall = await buildRecallContext(event.prompt ?? '', config.contextInjection, (q) =>
      mem0!.search(q, { filters: resolveSearchFilters(config.defaultScope, scopeCtx) })
    );
    if (recall) extra += '\n\n' + recall;

    if (config.dream.enabled && config.dream.auto && !dreamTriggered && !dreamChecked) {
      const gates = checkCheapGates(CONFIG_DIR, config.dream);
      if (gates.proceed) {
        try {
          const filters = resolveSearchFilters(config.defaultScope, scopeCtx);
          const result = await mem0!.getAll({ filters });
          const count = result.count ?? (result.results ?? []).length;
          dreamChecked = true;
          const memGate = checkMemoryGate(count, config.dream);

          if (memGate.pass && acquireDreamLock(CONFIG_DIR)) {
            dreamTriggered = true;
            extra += '\n\n' + DREAM_PROTOCOL;
            captureEvent('pi.dream.triggered', { memory_count: count }, telemetryCtx);
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

  // ── agent_end: auto-capture is handled by setupAutoCapture; this hook
  //    only tracks dream completion (D6/D9) ─────────────────────────────
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
      recordDreamCompletion(CONFIG_DIR);
      captureEvent('pi.dream.completed', {}, telemetryCtx);
    }

    releaseDreamLock(CONFIG_DIR);
    dreamTriggered = false;
  });

  // ── session_shutdown: release dream lock if still held ──────────────
  pi.on('session_shutdown', async () => {
    captureEvent('pi.session.stop', {}, telemetryCtx);
    if (dreamTriggered) {
      releaseDreamLock(CONFIG_DIR);
      dreamTriggered = false;
    }
  });
}
