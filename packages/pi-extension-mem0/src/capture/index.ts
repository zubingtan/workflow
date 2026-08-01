import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { MemoryClientLike, Mem0ExtensionConfig, ScopeContext } from '../types.js';
import { resolveAddParams } from '../memory/scoping.js';
import { captureEvent } from '../telemetry.js';

interface MessageLike {
  role: string;
  content?: unknown;
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text);
    return texts.length > 0 ? texts.join('\n') : null;
  }
  return null;
}

export function extractConversation(
  messages: MessageLike[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const result: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const msg of messages) {
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    const text = extractText(msg.content);
    if (!text) continue;
    result.push({ role: msg.role as 'user' | 'assistant', content: text });
  }
  return result;
}

export function setupAutoCapture(
  pi: ExtensionAPI,
  mem0: MemoryClientLike,
  config: Mem0ExtensionConfig,
  getScopeCtx: () => ScopeContext
): void {
  if (!config.autoCapture) return;

  pi.on('agent_end', async (event) => {
    const messages = event.messages ?? [];
    const conversation = extractConversation(messages);
    if (conversation.length === 0) return;

    const scopeCtx = getScopeCtx();
    const addParams = resolveAddParams('agent', scopeCtx);

    try {
      await mem0.add(conversation, addParams);
      captureEvent('capture.auto', { success: true, message_count: conversation.length });
    } catch (err: unknown) {
      captureEvent('capture.auto', {
        success: false,
        error_type: err instanceof Error ? err.name : 'unknown',
      });
      console.error('[mem0] auto-capture failed:', err);
    }
  });
}
