import { FlowNodeJSON } from '@flowgram.ai/free-layout-editor';

import type { IJsonSchema } from '@/form-semantics';

export interface FeishuTriggerNodeJSON extends FlowNodeJSON {
  data: {
    title: string;
    enabled: boolean;
    appId: string;
    appSecret: string;
    onlyWhenMentioned: boolean;
    chatIdAllowlist: string;
    contextMode: 'auto' | 'thread' | 'chat_window';
    maxMessages: number;
    windowMinutes: number;
    outputs: IJsonSchema<'object'>;
  };
}
