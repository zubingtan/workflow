import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeReceiveMessageEvent, parseFeishuEventBody } from './feishu-events.mjs';

describe('parseFeishuEventBody', () => {
  test('handles Feishu URL verification challenge', () => {
    const result = parseFeishuEventBody(
      { type: 'url_verification', token: 'token_1', challenge: 'challenge_1' },
      { verificationToken: 'token_1' }
    );

    assert.deepEqual(result, { kind: 'challenge', challenge: 'challenge_1' });
  });

  test('rejects mismatched verification token', () => {
    assert.throws(
      () => parseFeishuEventBody({ token: 'bad' }, { verificationToken: 'good' }),
      /token mismatch/
    );
  });
});

describe('normalizeReceiveMessageEvent', () => {
  test('extracts query and Feishu context ids from an at-bot group message', () => {
    const result = normalizeReceiveMessageEvent({
      header: {
        event_id: 'evt_1',
        event_type: 'im.message.receive_v1',
        tenant_key: 'tenant_1',
      },
      event: {
        sender: {
          sender_type: 'user',
          sender_id: { open_id: 'ou_1', user_id: 'u_1', union_id: 'on_1' },
        },
        message: {
          message_id: 'om_1',
          root_id: 'om_root',
          parent_id: 'om_parent',
          thread_id: 'omt_1',
          chat_id: 'oc_1',
          chat_type: 'group',
          message_type: 'text',
          create_time: '1710000000000',
          content: JSON.stringify({ text: '@_user_1 请分析这个报警' }),
          mentions: [
            {
              key: '@_user_1',
              id: { open_id: 'ou_bot' },
              mentioned_type: 'bot',
              name: 'workflow-bot',
            },
          ],
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.query, '请分析这个报警');
    assert.equal(result.rawText, '@_user_1 请分析这个报警');
    assert.equal(result.chatId, 'oc_1');
    assert.equal(result.threadId, 'omt_1');
    assert.equal(result.messageId, 'om_1');
    assert.equal(result.senderOpenId, 'ou_1');
  });

  test('ignores text messages that do not mention the bot', () => {
    const result = normalizeReceiveMessageEvent({
      header: { event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_type: 'user' },
        message: {
          message_id: 'om_1',
          chat_id: 'oc_1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hello' }),
          mentions: [],
        },
      },
    });

    assert.deepEqual(result, { ok: false, reason: 'bot_not_mentioned' });
  });
});
