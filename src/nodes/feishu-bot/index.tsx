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
          receiveId: {
            type: 'template',
            content: '',
          },
        },
        msgType: 'text',
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
