/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Field } from '@flowgram.ai/free-layout-editor';

import { TypeScriptCodeEditor } from '@/form-semantics';
import type { IJsonSchema } from '@/form-semantics';
import { Separator } from '@/components/ui';

import { useIsSidebar, useNodeRenderContext } from '../../../hooks';

export function Code() {
  const isSidebar = useIsSidebar();
  const { readonly } = useNodeRenderContext();

  if (!isSidebar) {
    return null;
  }

  return (
    <>
      <Separator />
      <Field<IJsonSchema<'object'>> name="inputs">
        {({ field: inputsField }) => (
          <Field<string> name="script.content">
            {({ field }) => (
              <TypeScriptCodeEditor
                value={field.value}
                onChange={(value) => field.onChange(value)}
                readonly={readonly}
                paramsSchema={inputsField.value}
              />
            )}
          </Field>
        )}
      </Field>
    </>
  );
}
