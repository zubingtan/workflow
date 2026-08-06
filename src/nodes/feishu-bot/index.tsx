import { nanoid } from 'nanoid';

import { WorkflowNodeType } from '../constants';
import { FlowNodeRegistry } from '../../typings';
import iconFeishu from '../../assets/icon-feishu.svg';
import { formMeta } from './form-meta';

let index = 0;

export const FeishuBotNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.FeishuBot,
  info: {
    icon: iconFeishu,
    description: 'Send a message via Feishu bot',
  },
  meta: {
    size: {
      width: 360,
      height: 460,
    },
  },
  onAdd() {
    return {
      id: `feishu_bot_${nanoid(5)}`,
      type: 'feishu-bot',
      data: {
        title: `FeishuBot_${++index}`,
        botType: 'webhook',
        webhook: {
          url: {
            type: 'template',
            content: '',
          },
          secret: '',
        },
        app: {
          appId: '',
          appSecret: '',
          receiveIdType: 'chat_id',
          // Deprecated dynamic field location. Kept for older saved workflows;
          // new edits write Receive ID into inputsValues.receiveId.
          receiveId: {
            type: 'template',
            content: '',
          },
          // Deprecated dynamic field location. Kept for older saved workflows;
          // new edits write Reply Message ID into inputsValues.replyToMessageId.
          replyToMessageId: {
            type: 'template',
            content: '',
          },
        },
        msgType: 'text',
        inputsValues: {
          receiveId: {
            type: 'template',
            content: '',
          },
          replyToMessageId: {
            type: 'template',
            content: '',
          },
          textContent: {
            type: 'template',
            content: '',
          },
          postContent: {
            type: 'template',
            content: '',
          },
          cardContent: {
            type: 'template',
            content: '',
          },
        },
        inputs: {
          type: 'object',
          properties: {
            receiveId: { type: 'string' },
            replyToMessageId: { type: 'string' },
            textContent: { type: 'string' },
            postContent: { type: 'string' },
            cardContent: { type: 'string' },
          },
        },
        // Deprecated dynamic field locations. Kept for older saved workflows;
        // new edits write message content into inputsValues.*.
        textContent: {
          type: 'template',
          content: '',
        },
        postContent: {
          type: 'template',
          content: '',
        },
        cardContent: {
          type: 'template',
          content: '',
        },
        outputs: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            messageId: { type: 'string' },
            response: { type: 'object' },
          },
        },
      },
    };
  },
  formMeta: formMeta,
};
