import { FlowNodeJSON } from '@flowgram.ai/free-layout-editor';
import { IFlowTemplateValue, IJsonSchema } from '@flowgram.ai/form-materials';

/**
 * Feishu Bot node JSON shape.
 *
 * Two bot modes:
 * - webhook: custom bot via group webhook URL (simplest, send-only)
 * - app: app bot via tenant_access_token (full API, send to user/group)
 */
export interface FeishuBotNodeJSON extends FlowNodeJSON {
  data: {
    title: string;
    /** Bot mode: webhook (custom bot) or app (app bot) */
    botType: 'webhook' | 'app';
    /** Webhook mode config */
    webhook: {
      /** Full webhook URL: https://open.feishu.cn/open-apis/bot/v2/hook/{token} */
      url: IFlowTemplateValue;
      /** Secret for signature verification (optional) */
      secret?: string;
    };
    /** App bot mode config */
    app: {
      /** App ID from Feishu developer console */
      appId: string;
      /** App Secret from Feishu developer console */
      appSecret: string;
      /** receive_id_type: open_id / user_id / union_id / email / chat_id */
      receiveIdType: 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id';
      /** The receiver ID value */
      receiveId: IFlowTemplateValue;
    };
    /** Message type: text / post / interactive */
    msgType: 'text' | 'post' | 'interactive';
    /** Text message content (when msgType=text) */
    textContent: IFlowTemplateValue;
    /** Rich text (post) message content — JSON string of post structure (when msgType=post) */
    postContent: IFlowTemplateValue;
    /** Interactive card content — JSON string of card structure (when msgType=interactive) */
    cardContent: IFlowTemplateValue;
    outputs: IJsonSchema<'object'>;
  };
}
