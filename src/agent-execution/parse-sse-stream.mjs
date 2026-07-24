/**
 * Incremental SSE frame parser for Agent Execution streams.
 *
 * Reads from a `ReadableStreamDefaultReader<Uint8Array>`, decodes bytes to
 * text, splits on `\n`, and emits one callback per `data: <json>` event.
 * Lines without the `data: ` prefix (comments, `event:`, `id:`, blank lines)
 * are ignored. Malformed JSON payloads are silently skipped.
 *
 * The parser is stateless across invocations: it owns one `buffer` string
 * that holds the trailing partial line between `read()` calls, so an event
 * split across chunks is correctly reassembled.
 *
 * Events are delivered in the same shape the backend SSE adapter writes
 * (see server/sse-adapter.mjs + projectTerminal):
 *   {type:"content_delta", content}
 *   {type:"tool_start", toolName, args}
 *   {type:"tool_end", toolName, result, isError}
 *   {type:"finish"}
 *   {type:"cancelled"}
 *   {type:"error", message, kind}
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {(event: any) => void} onEvent
 * @returns {Promise<void>} resolves when the stream closes (reader.done).
 */
export async function parseSseStream(reader, onEvent) {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Split on newline; the last segment may be a partial line — keep it buffered.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const ev = parseLine(line);
      if (ev !== null) onEvent(ev);
    }
  }

  // Flush any trailing line that lacked a final newline.
  if (buffer.length > 0) {
    const ev = parseLine(buffer);
    if (ev !== null) onEvent(ev);
  }
}

/**
 * Parse a single SSE line. Returns the deserialized event object, or null if
 * the line is not a `data: <json>` event (blank, comment, other field, or
 * malformed JSON).
 */
function parseLine(line) {
  if (!line.startsWith('data: ')) return null;
  const payload = line.slice(6).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
