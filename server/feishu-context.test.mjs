import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchFeishuContext } from './feishu-context.mjs';

const EVENT = {
  messageId: 'om_current',
  rootId: 'om_root',
  parentId: '',
  chatId: 'oc_1',
  createTime: '1710000000000',
  messageType: 'text',
  senderUserId: 'u_1',
  rawText: '@_user_1 当前问题',
};

test('fetchFeishuContext fetches thread replies and formats them for LLM input', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (String(url).includes('tenant_access_token')) {
      return Response.json({ code: 0, tenant_access_token: 'token_1' });
    }
    return Response.json({
      code: 0,
      data: {
        items: [
          {
            message_id: 'om_reply',
            create_time: '1710000001000',
            msg_type: 'text',
            sender: { sender_type: 'user', sender_id: { user_id: 'u_2' } },
            body: { content: JSON.stringify({ text: '前文上下文' }) },
          },
        ],
      },
    });
  };

  const result = await fetchFeishuContext(EVENT, {
    appId: 'cli_a',
    appSecret: 'secret',
    fetchImpl,
  });

  assert.equal(result.contextFetchError, '');
  assert.equal(result.contextMessages.length, 2);
  assert.match(result.contextText, /当前问题/);
  assert.match(result.contextText, /前文上下文/);
  assert.ok(urls.some((url) => url.includes('/im/v1/messages/om_root/replies')));
});

test('fetchFeishuContext falls back to the current message if credentials are missing', async () => {
  const result = await fetchFeishuContext(EVENT);

  assert.equal(result.contextFetchError, 'missing_app_credentials');
  assert.equal(result.contextMessages.length, 1);
  assert.match(result.contextText, /当前问题/);
});
