/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Field } from '@flowgram.ai/free-layout-editor';

import { PromptEditorWithVariables } from '@/form-semantics';
import type { IFlowTemplateValue } from '@/form-semantics';
import { Select } from '@/components/ui';

import { useNodeRenderContext } from '../../../hooks';
import { FormItem } from '../../../form-components';

export function Api() {
  const { readonly } = useNodeRenderContext();

  return (
    <div>
      <FormItem name="API" required vertical type="string">
        <div style={{ display: 'flex', gap: 5 }}>
          <Field<string> name="api.method" defaultValue="GET">
            {({ field }) => (
              <Select
                value={field.value}
                onChange={(event) => field.onChange(event.currentTarget.value)}
                className="w-[85px] shrink-0"
                disabled={readonly}
              >
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'].map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field<IFlowTemplateValue> name="api.url">
            {({ field }) => (
              <PromptEditorWithVariables
                readonly={readonly}
                style={{ flexGrow: 1 }}
                placeholder="Input URL, use var by '{'"
                value={field.value}
                onChange={(value) => {
                  field.onChange(value!);
                }}
              />
            )}
          </Field>
        </div>
      </FormItem>
    </div>
  );
}
