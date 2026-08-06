import { nanoid } from 'nanoid';

import { WorkflowNodeType } from '../constants';
import { FlowNodeRegistry } from '../../typings';
import iconFeishu from '../../assets/icon-feishu.svg';
import { formMeta } from './form-meta';

let index = 0;

export const FeishuTriggerNodeRegistry: FlowNodeRegistry = {
  type: WorkflowNodeType.FeishuTrigger,
  info: {
    icon: iconFeishu,
    description: 'Trigger this workflow from Feishu @bot events',
  },
  meta: {
    size: {
      width: 360,
      height: 420,
    },
  },
  onAdd() {
    return {
      id: `feishu_trigger_${nanoid(5)}`,
      type: 'feishu-trigger',
      data: {
        title: `FeishuTrigger_${++index}`,
        enabled: true,
        appId: '',
        appSecret: '',
        onlyWhenMentioned: true,
        chatIdAllowlist: '',
        contextMode: 'auto',
        maxMessages: 20,
        windowMinutes: 30,
        outputs: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            rawText: { type: 'string' },
            contextText: { type: 'string' },
            contextMessages: { type: 'array' },
            chatId: { type: 'string' },
            chatType: { type: 'string' },
            threadId: { type: 'string' },
            messageId: { type: 'string' },
            rootId: { type: 'string' },
            parentId: { type: 'string' },
            senderOpenId: { type: 'string' },
            senderUserId: { type: 'string' },
            senderUnionId: { type: 'string' },
            tenantKey: { type: 'string' },
            contextFetchError: { type: 'string' },
          },
        },
      },
    };
  },
  formMeta,
};
