/**
 * Feishu Bot executor — sends messages via Feishu (飞书) bot API.
 *
 * Two modes:
 * - webhook: custom bot via group webhook URL (send-only, no token needed)
 * - app: app bot via tenant_access_token (full API, send to user/group)
 *
 * Credential handling follows the same pattern as AgentExecutor: secrets
 * (webhook secret, app_secret) stay in node data and are resolved at execution
 * time. This is acceptable for Feishu because:
 *   - webhook secret is a per-bot signing secret, not a user credential
 *   - app_secret is an application credential stored in the workflow definition
 * For production use, consider storing these in a separate credentials store
 * (similar to the agents table for LLM keys).
 */
import { createHmac } from 'node:crypto';

/**
 * Generate Feishu webhook signature.
 * Algorithm: HMAC-SHA256 with key = `${timestamp}\n${secret}`, signing empty string, then Base64.
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {string} secret - Webhook secret
 * @returns {string} Base64-encoded signature
 */
export function genWebhookSign(timestamp, secret) {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = createHmac('sha256', stringToSign);
  hmac.update('');
  return hmac.digest('base64');
}

/**
 * Get tenant_access_token for app bot mode.
 * @param {string} appId
 * @param {string} appSecret
 * @returns {Promise<string>} tenant_access_token
 */
export async function getTenantAccessToken(appId, appSecret, fetchImpl = fetch) {
  const res = await fetchImpl(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }
  );
  const data = await res.json();
  if (data.code !== 0) {
    throw new Error(`Failed to get tenant_access_token: ${data.msg} (code: ${data.code})`);
  }
  return data.tenant_access_token;
}

/**
 * Build the request body for a Feishu message based on bot type and msg type.
 *
 * @param {object} opts
 * @param {'webhook'|'app'} opts.botType
 * @param {'text'|'post'|'interactive'} opts.msgType
 * @param {string} opts.textContent - text message content
 * @param {string} opts.postContent - JSON string of post structure
 * @param {string} opts.cardContent - JSON string of card structure
 * @param {string} [opts.secret] - webhook secret (for signing)
 * @returns {object} request body object
 */
export function buildMessageBody({
  botType,
  msgType,
  textContent,
  postContent,
  cardContent,
  secret,
}) {
  const body = {};

  // Webhook mode: add signature if secret is set
  if (botType === 'webhook' && secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = genWebhookSign(timestamp, secret);
  }

  switch (msgType) {
    case 'text':
      body.msg_type = 'text';
      body.content = { text: textContent };
      break;
    case 'post':
      body.msg_type = 'post';
      body.content = { post: JSON.parse(postContent) };
      break;
    case 'interactive':
      body.msg_type = 'interactive';
      body.card = JSON.parse(cardContent);
      break;
    default:
      throw new Error(`Unsupported message type: ${msgType}`);
  }

  return body;
}

/**
 * Resolve template value to string.
 * FlowGram template values come as { type: 'template', content: '...' } or
 * { type: 'constant', content: '...' } or plain string.
 */
export function resolveTemplateValue(val) {
  if (val == null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val.content != null) return String(val.content);
  return String(val);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

/**
 * Execute a Feishu bot message send.
 *
 * @param {object} opts
 * @param {object} opts.nodeData - node.data from FlowGram runtime
 * @param {object} opts.inputs - resolved inputs (same as nodeData for this node)
 * @returns {Promise<{outputs: {success: boolean, messageId: string, response: object}}>}
 */
export async function executeFeishuBot({ nodeData, inputs }) {
  const botType = nodeData.botType || inputs.botType || 'webhook';
  const msgType = nodeData.msgType || inputs.msgType || 'text';

  const textContent = resolveTemplateValue(
    firstDefined(inputs.textContent, nodeData.inputsValues?.textContent, nodeData.textContent)
  );
  const postContent = resolveTemplateValue(
    firstDefined(inputs.postContent, nodeData.inputsValues?.postContent, nodeData.postContent)
  );
  const cardContent = resolveTemplateValue(
    firstDefined(inputs.cardContent, nodeData.inputsValues?.cardContent, nodeData.cardContent)
  );

  let url;
  let headers = { 'Content-Type': 'application/json' };
  let body;

  if (botType === 'webhook') {
    // Custom bot webhook: URL is the full webhook endpoint
    const webhookUrl = resolveTemplateValue(firstDefined(inputs.webhookUrl, nodeData.webhook?.url));
    if (!webhookUrl) {
      throw new Error('Webhook URL is required');
    }
    url = webhookUrl;
    const secret = nodeData.webhook?.secret || inputs.webhook?.secret;
    body = buildMessageBody({ botType, msgType, textContent, postContent, cardContent, secret });
  } else if (botType === 'app') {
    // App bot: get tenant_access_token then call /im/v1/messages
    const appId = nodeData.app?.appId || inputs.app?.appId;
    const appSecret = nodeData.app?.appSecret || inputs.app?.appSecret;
    const receiveIdType = nodeData.app?.receiveIdType || inputs.app?.receiveIdType || 'chat_id';
    const receiveId = resolveTemplateValue(
      firstDefined(
        inputs.receiveId,
        inputs.app?.receiveId,
        nodeData.inputsValues?.receiveId,
        nodeData.app?.receiveId
      )
    );
    const replyToMessageId = resolveTemplateValue(
      firstDefined(
        inputs.replyToMessageId,
        inputs.app?.replyToMessageId,
        nodeData.inputsValues?.replyToMessageId,
        nodeData.app?.replyToMessageId
      )
    );

    if (!appId || !appSecret) {
      throw new Error('App ID and App Secret are required for app bot mode');
    }
    if (!receiveId && !replyToMessageId) {
      throw new Error('Receive ID or Reply Message ID is required for app bot mode');
    }

    const token = await getTenantAccessToken(appId, appSecret);
    headers['Authorization'] = `Bearer ${token}`;

    const msgBody = buildMessageBody({ botType, msgType, textContent, postContent, cardContent });
    const appMessageBody = {
      msg_type: msgType === 'interactive' ? 'interactive' : msgType,
      content: JSON.stringify(msgType === 'interactive' ? msgBody.card : msgBody.content),
    };

    if (replyToMessageId) {
      url = `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(
        replyToMessageId
      )}/reply`;
      body = {
        ...appMessageBody,
        reply_in_thread: true,
      };
    } else {
      url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`;
      // App bot send API requires receive_id + content as JSON string.
      body = {
        receive_id: receiveId,
        ...appMessageBody,
      };
    }
  } else {
    throw new Error(`Unsupported bot type: ${botType}`);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const responseJson = await res.json().catch(() => ({}));

  // Feishu success: code=0 (app bot) or StatusCode=0 (webhook)
  const success = responseJson.code === 0 || responseJson.StatusCode === 0;
  const messageId = responseJson.data?.message_id ?? '';
  const errorMsg = responseJson.msg || responseJson.StatusMessage || '';

  if (!success) {
    return {
      outputs: {
        success: false,
        messageId: '',
        response: responseJson,
        _error: `Feishu API error: ${errorMsg} (code: ${
          responseJson.code ?? responseJson.StatusCode
        })`,
      },
    };
  }

  return {
    outputs: {
      success: true,
      messageId,
      response: responseJson,
    },
  };
}
