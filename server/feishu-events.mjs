import { createDecipheriv, createHash } from 'node:crypto';

export const FEISHU_RECEIVE_MESSAGE_EVENT = 'im.message.receive_v1';

export class FeishuEventError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FeishuEventError';
    this.code = code;
  }
}

function decryptEventPayload(encrypt, encryptKey) {
  if (!encryptKey) {
    throw new FeishuEventError(
      'missing_encrypt_key',
      'FEISHU_EVENT_ENCRYPT_KEY is required for encrypted events'
    );
  }
  const key = createHash('sha256').update(encryptKey).digest();
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypt, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(decrypted);
}

export function parseFeishuEventBody(body, { verificationToken = '', encryptKey = '' } = {}) {
  if (!body || typeof body !== 'object') {
    throw new FeishuEventError('invalid_body', 'Feishu event body must be an object');
  }

  const payload = body.encrypt ? decryptEventPayload(body.encrypt, encryptKey) : body;

  if (payload.type === 'url_verification' || payload.challenge) {
    if (verificationToken && payload.token !== verificationToken) {
      throw new FeishuEventError('invalid_token', 'Feishu verification token mismatch');
    }
    return { kind: 'challenge', challenge: payload.challenge };
  }

  const token = payload.header?.token ?? payload.token;
  if (verificationToken && token !== verificationToken) {
    throw new FeishuEventError('invalid_token', 'Feishu verification token mismatch');
  }

  return { kind: 'event', payload };
}

function parseMessageContent(content) {
  if (!content) return {};
  if (typeof content === 'object') return content;
  try {
    return JSON.parse(content);
  } catch {
    return { text: String(content) };
  }
}

function removeMentionKeys(text, mentions) {
  let next = text ?? '';
  for (const mention of mentions ?? []) {
    if (mention?.key) {
      next = next.split(mention.key).join('');
    }
  }
  return next.replace(/\s+/g, ' ').trim();
}

export function normalizeReceiveMessageEvent(payload, { requireBotMention = true } = {}) {
  if (payload?.header?.event_type !== FEISHU_RECEIVE_MESSAGE_EVENT) {
    return { ok: false, reason: 'unsupported_event_type' };
  }

  const event = payload.event ?? {};
  const message = event.message ?? {};
  const sender = event.sender ?? {};
  if (!message.message_id) {
    return { ok: false, reason: 'missing_message_id' };
  }
  if (!message.chat_id) {
    return { ok: false, reason: 'missing_chat_id' };
  }
  if (sender.sender_type === 'bot') {
    return { ok: false, reason: 'bot_sender' };
  }
  if (message.message_type !== 'text') {
    return { ok: false, reason: 'unsupported_message_type' };
  }

  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const botMention = mentions.find((m) => m?.mentioned_type === 'bot');
  if (requireBotMention && !botMention) {
    return { ok: false, reason: 'bot_not_mentioned' };
  }

  const content = parseMessageContent(message.content);
  const rawText = content.text ?? '';
  const query = removeMentionKeys(rawText, mentions);

  return {
    ok: true,
    eventId: payload.header?.event_id ?? '',
    tenantKey: payload.header?.tenant_key ?? event.tenant_key ?? '',
    messageId: message.message_id,
    rootId: message.root_id ?? '',
    parentId: message.parent_id ?? '',
    threadId: message.thread_id ?? '',
    chatId: message.chat_id,
    chatType: message.chat_type,
    createTime: message.create_time,
    messageType: message.message_type,
    rawText,
    query,
    mentions,
    senderOpenId: sender.sender_id?.open_id ?? '',
    senderUserId: sender.sender_id?.user_id ?? '',
    senderUnionId: sender.sender_id?.union_id ?? '',
  };
}

export function parseFeishuMessageText(message) {
  const content = parseMessageContent(message?.body?.content ?? message?.content);
  return content.text ?? '';
}

export function formatContextText(messages) {
  return messages
    .map((message) => {
      const author = message.senderType === 'bot' ? 'bot' : message.senderId || 'user';
      return `[${message.createTime || 'unknown'}] ${author}: ${message.text}`;
    })
    .join('\n');
}
