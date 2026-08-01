import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import type { MemoryClientLike, Scope, ScopeContext, Mem0ExtensionConfig } from '../types.js';
import { resolveSearchFilters, resolveAddParams } from './scoping.js';
import { formatMemoryList } from './formatting.js';
import { captureToolEvent } from '../telemetry.js';

const MAX_OUTPUT_LINES = 200;
const MAX_OUTPUT_BYTES = 50_000;

function truncateOutput(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= MAX_OUTPUT_LINES && text.length <= MAX_OUTPUT_BYTES) {
    return text;
  }
  const kept = lines.slice(0, MAX_OUTPUT_LINES);
  let result = kept.join('\n');
  if (result.length > MAX_OUTPUT_BYTES) {
    result = result.slice(0, MAX_OUTPUT_BYTES);
  }
  const dropped = lines.length - kept.length;
  if (dropped > 0 || text.length > MAX_OUTPUT_BYTES) {
    result += `\n\n[Output truncated: showing ${kept.length} of ${lines.length} lines]`;
  }
  return result;
}

interface ToolParams {
  action: 'search' | 'add' | 'get_all' | 'update' | 'delete' | 'delete_all';
  query?: string;
  content?: string;
  memory_id?: string;
  scope?: Scope;
}

export function buildToolExecute(
  mem0: MemoryClientLike,
  scopeCtx: ScopeContext,
  defaultScope: Scope,
  searchThreshold?: number
) {
  return async (params: ToolParams, signal?: AbortSignal) => {
    const scope = params.scope ?? defaultScope;

    switch (params.action) {
      case 'search': {
        if (signal?.aborted) throw new Error('Cancelled');
        if (!params.query) throw new Error('query is required for search');
        const filters = resolveSearchFilters(scope, scopeCtx);
        const result = await mem0.search(params.query, { filters, threshold: searchThreshold });
        const memories = result.results ?? [];
        return {
          content: [{ type: 'text' as const, text: truncateOutput(formatMemoryList(memories)) }],
          details: { matchCount: memories.length },
        };
      }

      case 'add': {
        if (signal?.aborted) throw new Error('Cancelled');
        if (!params.content) throw new Error('content is required for add');
        const addParams = resolveAddParams(scope, scopeCtx);
        const result = await mem0.add([{ role: 'user', content: params.content }], addParams);
        const count = result.results?.length ?? 0;
        return {
          content: [
            {
              type: 'text' as const,
              text: `Memory stored (${count} event${count === 1 ? '' : 's'}).`,
            },
          ],
          details: { count },
        };
      }

      case 'get_all': {
        if (signal?.aborted) throw new Error('Cancelled');
        const filters = resolveSearchFilters(scope, scopeCtx);
        const result = await mem0.getAll({ filters });
        const memories = result.results ?? [];
        return {
          content: [{ type: 'text' as const, text: truncateOutput(formatMemoryList(memories)) }],
          details: { totalCount: result.count ?? memories.length },
        };
      }

      case 'update': {
        if (signal?.aborted) throw new Error('Cancelled');
        if (!params.memory_id) throw new Error('memory_id is required for update');
        if (!params.content) throw new Error('content is required for update');
        await mem0.update(params.memory_id, { text: params.content });
        return {
          content: [{ type: 'text' as const, text: 'Memory updated.' }],
          details: { memoryId: params.memory_id },
        };
      }

      case 'delete': {
        if (signal?.aborted) throw new Error('Cancelled');
        if (!params.memory_id) throw new Error('memory_id is required for delete');
        const result = await mem0.delete(params.memory_id);
        return {
          content: [{ type: 'text' as const, text: result.message ?? 'Memory deleted.' }],
          details: {},
        };
      }

      case 'delete_all': {
        if (signal?.aborted) throw new Error('Cancelled');
        if (scope === 'session') {
          throw new Error(
            'delete_all with scope "session" is not supported by the mem0 self-hosted API. ' +
              'Use scope "agent" to delete all agent memories, or delete individual memories with "delete".'
          );
        }
        const delParams = resolveAddParams(scope, scopeCtx);
        const result = await mem0.deleteAll(delParams);
        return {
          content: [{ type: 'text' as const, text: result.message ?? 'All memories deleted.' }],
          details: {},
        };
      }
    }
  };
}

export function registerMemoryTool(
  pi: ExtensionAPI,
  mem0: MemoryClientLike,
  config: Mem0ExtensionConfig,
  getScopeCtx: () => ScopeContext
): void {
  pi.registerTool({
    name: 'mem0_memory',
    label: 'Mem0 Memory',
    description:
      'Search, add, update, and manage persistent semantic memories powered by a self-hosted Mem0 server. Memories persist across sessions. Use action "search" proactively -- before answering anything that may depend on what the user told you earlier -- and run multiple searches with different phrasings for multi-part questions. Output is truncated to 200 lines / 50KB.',
    promptSnippet: 'Semantic memory search and storage via self-hosted Mem0',
    promptGuidelines: [
      'Use mem0_memory with action "search" proactively whenever the request may depend on the user\'s past work, preferences, decisions, or environment -- not only when they explicitly mention the past',
      'For multi-part or comparative questions, run several searches with different phrasings and combine the results before answering -- one search is rarely enough',
      'Use mem0_memory with action "add" to save important facts, preferences, goals, decisions, or lessons the user shares',
      'Use mem0_memory with action "update" to modify an existing memory — requires memory_id and content. Preserves the memory ID',
      'Always use the default agent scope unless the user EXPLICITLY asks to search within this session only — only then use scope "session"',
      'Do NOT pass scope at all for normal queries — omitting it uses the agent default automatically',
    ],
    parameters: Type.Object({
      action: StringEnum(['search', 'add', 'get_all', 'update', 'delete', 'delete_all'] as const, {
        description:
          'Memory operation to run: "search" (semantic recall -- use proactively before answering; run several with different phrasings for multi-part questions), "add" (save a new fact/preference/decision), "get_all" (list everything in scope, no query needed), "update" (replace an existing memory\'s text by id), "delete" (remove one memory by id), "delete_all" (wipe every memory in the scope -- destructive, only on explicit request).',
      }),
      query: Type.Optional(
        Type.String({
          description:
            'Search text -- required for action "search". Use a focused noun-phrase; for multi-part questions run several searches with different phrasings.',
        })
      ),
      content: Type.Optional(
        Type.String({
          description:
            'Memory text -- required for action "add" (the fact to store) and "update" (the replacement text).',
        })
      ),
      memory_id: Type.Optional(
        Type.String({
          description:
            'Target memory\'s ID -- required for "update" and "delete". Use an ID returned by a prior "search" or "get_all".',
        })
      ),
      scope: Type.Optional(
        StringEnum(['agent', 'session'] as const, {
          description:
            'Where to read/write: "agent" (default -- this agent\'s memories), "session" (this run only). Omit for normal queries.',
        })
      ),
    }),
    async execute(toolCallId, params, signal) {
      const scopeCtx = getScopeCtx();
      const exec = buildToolExecute(mem0, scopeCtx, config.defaultScope, config.searchThreshold);
      const start = Date.now();
      try {
        const result = await exec(params as ToolParams, signal);
        const details = (result as any).details ?? {};
        captureToolEvent((params as ToolParams).action, {
          success: true,
          latency_ms: Date.now() - start,
          result_count: details.matchCount ?? details.totalCount ?? undefined,
        });
        return result as any;
      } catch (err) {
        captureToolEvent((params as ToolParams).action, {
          success: false,
          latency_ms: Date.now() - start,
          error_type: err instanceof Error ? err.name : 'unknown',
        });
        throw err;
      }
    },
  });
}
