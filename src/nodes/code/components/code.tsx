/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Field } from '@flowgram.ai/free-layout-editor';
import { Divider } from '@douyinfe/semi-ui';

import { TypeScriptCodeEditor } from '@/form-semantics/legacy-adapter';

import { useTheme } from '../../../theme';
import { useIsSidebar, useNodeRenderContext } from '../../../hooks';

export function Code() {
  const isSidebar = useIsSidebar();
  const { readonly } = useNodeRenderContext();
  const { resolvedTheme } = useTheme();

  if (!isSidebar) {
    return null;
  }

  return (
    <>
      <Divider />
      <Field<string> name="script.content">
        {({ field }) => (
          <TypeScriptCodeEditor
            value={field.value}
            onChange={(value) => field.onChange(value)}
            readonly={readonly}
            theme={resolvedTheme}
          />
        )}
      </Field>
    </>
  );
}
