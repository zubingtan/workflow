/**
 * @typedef {Object} SseContext
 * @property {string} id
 * @property {string} model
 * @property {number} created
 */

/**
 * @typedef {Object} SseMessage
 * @property {string} data
 * @property {string} [event]
 */

const FINISH_REASON_MAP = {
  stop: "stop",
  length: "length",
  toolUse: "tool_calls",
};

function chunk(id, created, model, delta, finishReason = null) {
  return {
    data: JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }),
  };
}

/**
 * @param {import("@earendil-works/pi-agent-core").AgentEvent} event
 * @param {SseContext} ctx
 * @returns {SseMessage[]}
 */
export function mapAgentEventToSse(event, ctx) {
  const { id, model, created } = ctx;
  const messages = [];

  switch (event.type) {
    case "message_update": {
      const evt = event.assistantMessageEvent;
      if (evt.type === "text_delta") {
        messages.push(chunk(id, created, model, { content: evt.delta }));
      } else if (evt.type === "toolcall_start") {
        const toolCall = event.message.content[evt.contentIndex];
        if (toolCall?.type === "toolCall") {
          messages.push(
            chunk(id, created, model, {
              tool_calls: [
                {
                  index: evt.contentIndex,
                  id: toolCall.id,
                  type: "function",
                  function: { name: toolCall.name, arguments: "" },
                },
              ],
            }),
          );
        }
      } else if (evt.type === "toolcall_delta") {
        messages.push(
          chunk(id, created, model, {
            tool_calls: [
              { index: evt.contentIndex, function: { arguments: evt.delta } },
            ],
          }),
        );
      }
      break;
    }
    case "message_end": {
      if (event.message.role !== "assistant") break;
      if (
        event.message.stopReason === "error" ||
        event.message.stopReason === "aborted"
      )
        break;
      const finishReason = FINISH_REASON_MAP[event.message.stopReason] ?? "stop";
      messages.push(chunk(id, created, model, {}, finishReason));
      break;
    }
    case "tool_execution_start":
      messages.push({
        event: "tool_execution_start",
        data: JSON.stringify({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
        }),
      });
      break;
    case "tool_execution_update":
      messages.push({
        event: "tool_execution_update",
        data: JSON.stringify({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          partialResult: event.partialResult,
        }),
      });
      break;
    case "tool_execution_end":
      messages.push({
        event: "tool_execution_end",
        data: JSON.stringify({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: event.result,
          isError: event.isError,
        }),
      });
      break;
  }

  return messages;
}
