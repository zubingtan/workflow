/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FlowNodeJSON } from '@flowgram.ai/free-layout-editor';

import type { IFlowValue, IJsonSchema } from '@/form-semantics';

export interface CodeNodeJSON extends FlowNodeJSON {
  data: {
    title: string;
    inputsValues: Record<string, IFlowValue>;
    inputs: IJsonSchema<'object'>;
    outputs: IJsonSchema<'object'>;
    script: {
      language: 'javascript';
      content: string;
    };
  };
}
