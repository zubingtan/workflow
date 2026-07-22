/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FlowNodeJSON } from '@flowgram.ai/free-layout-editor';
import { IFlowValue, IJsonSchema } from '@flowgram.ai/form-materials';

export interface LLMNodeJSON extends FlowNodeJSON {
  data: {
    title: string;
    inputsValues: {
      modelName?: IFlowValue;
      apiKey?: IFlowValue;
      apiHost?: IFlowValue;
      temperature?: IFlowValue;
      systemPrompt?: IFlowValue;
      prompt?: IFlowValue;
    };
    inputs: IJsonSchema<'object'>;
    outputs: IJsonSchema<'object'>;
  };
}
