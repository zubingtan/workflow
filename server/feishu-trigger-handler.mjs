import { fetchFeishuContext } from './feishu-context.mjs';
import { normalizeReceiveMessageEvent } from './feishu-events.mjs';

function parseWorkflowData(data) {
  if (!data) return null;
  if (typeof data === 'object') return data;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function getWorkflowNodes(schema) {
  if (!schema || typeof schema !== 'object') return [];
  if (Array.isArray(schema.nodes)) return schema.nodes;
  if (Array.isArray(schema?.document?.nodes)) return schema.document.nodes;
  return [];
}

function parseChatIdAllowlist(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function listEnabledFeishuTriggerCandidates(db) {
  const rows = db
    .prepare('SELECT id, data FROM workflows ORDER BY updated_at DESC, created_at DESC')
    .all();
  const candidates = [];
  for (const row of rows) {
    const schema = parseWorkflowData(row.data);
    for (const node of getWorkflowNodes(schema)) {
      if (node?.type !== 'feishu-trigger') continue;
      const data = node.data ?? {};
      if (data.enabled === false) continue;
      if (!data.appId || !data.appSecret) continue;
      candidates.push({
        workflowId: row.id,
        schema: row.data,
        nodeId: node.id,
        appId: data.appId,
        appSecret: data.appSecret,
        config: data,
      });
    }
  }
  return candidates;
}

function candidateMatchesEvent(candidate, event, appId) {
  if (appId && candidate.appId !== appId) return false;
  const allowlist = parseChatIdAllowlist(candidate.config.chatIdAllowlist);
  if (allowlist.length > 0 && !allowlist.includes(event.chatId)) return false;
  if (candidate.config.onlyWhenMentioned !== false) {
    return event.mentions?.some((mention) => mention?.mentioned_type === 'bot');
  }
  return true;
}

function findFeishuTriggerMatch(db, event, appId) {
  return listEnabledFeishuTriggerCandidates(db).find((candidate) =>
    candidateMatchesEvent(candidate, event, appId)
  );
}

const FEISHU_START_OUTPUT_PROPERTIES = {
  ok: { type: 'boolean' },
  eventId: { type: 'string' },
  tenantKey: { type: 'string' },
  messageId: { type: 'string' },
  rootId: { type: 'string' },
  parentId: { type: 'string' },
  threadId: { type: 'string' },
  chatId: { type: 'string' },
  chatType: { type: 'string' },
  createTime: { type: 'string' },
  messageType: { type: 'string' },
  rawText: { type: 'string' },
  query: { type: 'string' },
  mentions: { type: 'array' },
  contextText: { type: 'string' },
  contextMessages: { type: 'array' },
  contextFetchError: { type: 'string' },
  senderOpenId: { type: 'string' },
  senderUserId: { type: 'string' },
  senderUnionId: { type: 'string' },
  feishuTriggerNodeId: { type: 'string' },
};

export function withFeishuStartOutputs(schema) {
  const parsed = parseWorkflowData(schema);
  if (!parsed) return schema;
  const cloned = structuredClone(parsed);
  const start = getWorkflowNodes(cloned).find((node) => node?.type === 'start');
  if (!start) return cloned;

  start.data = start.data ?? {};
  start.data.outputs = start.data.outputs ?? { type: 'object', properties: {} };
  start.data.outputs.type = 'object';
  start.data.outputs.properties = {
    ...FEISHU_START_OUTPUT_PROPERTIES,
    ...(start.data.outputs.properties ?? {}),
  };
  return cloned;
}

export async function handleFeishuReceiveMessage({
  db,
  enqueueSavedWorkflowRun,
  payload,
  appId,
  fetchImpl = fetch,
}) {
  const event = normalizeReceiveMessageEvent(payload, { requireBotMention: false });
  if (!event.ok) return { ignored: true, reason: event.reason };

  const trigger = findFeishuTriggerMatch(db, event, appId);
  if (!trigger) return { ignored: true, reason: 'no_matching_feishu_trigger' };

  const inserted = db
    .prepare('INSERT OR IGNORE INTO feishu_event_dedup (message_id) VALUES (?)')
    .run(event.messageId);
  if (inserted.changes === 0) {
    const row = db
      .prepare('SELECT run_id FROM feishu_event_dedup WHERE message_id=?')
      .get(event.messageId);
    return { duplicate: true, runID: row?.run_id ?? null };
  }

  const { config } = trigger;
  const context = await fetchFeishuContext(event, {
    appId: config.appId,
    appSecret: config.appSecret,
    contextMode: config.contextMode,
    maxMessages: Number(config.maxMessages ?? 20),
    windowMinutes: Number(config.windowMinutes ?? 30),
    fetchImpl,
  });
  const inputs = { ...event, ...context, feishuTriggerNodeId: trigger.nodeId };
  const result = enqueueSavedWorkflowRun({
    workflowId: trigger.workflowId,
    schema: withFeishuStartOutputs(trigger.schema),
    inputs,
  });
  if (!result)
    return { error: 'workflow not found', workflowId: trigger.workflowId, statusCode: 404 };

  db.prepare('UPDATE feishu_event_dedup SET run_id=? WHERE message_id=?').run(
    result.runID,
    event.messageId
  );
  return { runID: result.runID, status: 'queued', workflowId: trigger.workflowId };
}
