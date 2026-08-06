import { getTenantAccessToken } from './feishu-executor.mjs';
import { formatContextText, parseFeishuMessageText } from './feishu-events.mjs';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

function toSeconds(time) {
  const n = Number(time);
  if (!Number.isFinite(n) || n <= 0) return Math.floor(Date.now() / 1000);
  return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
}

function normalizeMessage(item) {
  return {
    messageId: item.message_id ?? '',
    createTime: item.create_time ?? '',
    messageType: item.msg_type ?? item.message_type ?? '',
    senderType: item.sender?.sender_type ?? '',
    senderId:
      item.sender?.sender_id?.user_id ??
      item.sender?.sender_id?.open_id ??
      item.sender?.sender_id?.union_id ??
      '',
    text: parseFeishuMessageText(item),
  };
}

async function fetchJson(url, token, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0) {
    throw new Error(
      `Feishu context fetch failed: ${data.msg ?? res.statusText} (code: ${
        data.code ?? res.status
      })`
    );
  }
  return data;
}

async function fetchThreadReplies(rootMessageId, token, { maxMessages, fetchImpl }) {
  const url = `${FEISHU_API_BASE}/im/v1/messages/${encodeURIComponent(
    rootMessageId
  )}/replies?page_size=${maxMessages}`;
  const data = await fetchJson(url, token, fetchImpl);
  return Array.isArray(data.data?.items) ? data.data.items : [];
}

async function fetchChatWindow(event, token, { maxMessages, windowMinutes, fetchImpl }) {
  const center = toSeconds(event.createTime);
  const span = Math.max(1, Number(windowMinutes) || 30) * 60;
  const params = new URLSearchParams({
    container_id_type: 'chat',
    container_id: event.chatId,
    start_time: String(center - span),
    end_time: String(center + span),
    page_size: String(maxMessages),
  });
  const data = await fetchJson(`${FEISHU_API_BASE}/im/v1/messages?${params}`, token, fetchImpl);
  return Array.isArray(data.data?.items) ? data.data.items : [];
}

function currentMessage(event) {
  return {
    messageId: event.messageId,
    createTime: event.createTime,
    messageType: event.messageType,
    senderType: 'user',
    senderId: event.senderUserId || event.senderOpenId || event.senderUnionId,
    text: event.rawText,
  };
}

export async function fetchFeishuContext(
  event,
  {
    appId,
    appSecret,
    contextMode = 'auto',
    maxMessages = 20,
    windowMinutes = 30,
    fetchImpl = fetch,
  } = {}
) {
  const current = currentMessage(event);
  if (!appId || !appSecret) {
    return {
      contextMessages: [current],
      contextText: formatContextText([current]),
      contextFetchError: 'missing_app_credentials',
    };
  }

  let rawItems;
  let contextFetchError = '';
  try {
    const token = await getTenantAccessToken(appId, appSecret, fetchImpl);
    const rootMessageId = event.rootId || event.parentId;
    if (contextMode === 'thread') {
      rawItems = rootMessageId
        ? await fetchThreadReplies(rootMessageId, token, { maxMessages, fetchImpl })
        : [];
    } else if (contextMode === 'chat_window') {
      rawItems = await fetchChatWindow(event, token, { maxMessages, windowMinutes, fetchImpl });
    } else {
      rawItems = rootMessageId
        ? await fetchThreadReplies(rootMessageId, token, { maxMessages, fetchImpl })
        : await fetchChatWindow(event, token, { maxMessages, windowMinutes, fetchImpl });
    }
  } catch (err) {
    rawItems = [];
    contextFetchError = err?.message ?? 'context_fetch_failed';
  }
  const seen = new Set();
  const messages = [current, ...rawItems.map(normalizeMessage)]
    .filter((message) => {
      const key = message.messageId || `${message.createTime}:${message.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return message.text;
    })
    .slice(0, maxMessages);

  return {
    contextMessages: messages,
    contextText: formatContextText(messages),
    contextFetchError,
  };
}
