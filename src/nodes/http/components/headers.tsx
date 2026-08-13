/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Field } from '@flowgram.ai/free-layout-editor';

import { DisplayInputsValues, InputsValues } from '@/form-semantics';
import type { IInputsValues } from '@/form-semantics';

import { useIsSidebar, useNodeRenderContext } from '../../../hooks';
import { FormItem } from '../../../form-components';

export function Headers() {
  const { readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();

  if (!isSidebar) {
    return (
      <FormItem name="headers" type="object" vertical>
        <Field<IInputsValues | undefined> name="headersValues">
          {({ field }) => <DisplayInputsValues value={field.value} />}
        </Field>
      </FormItem>
    );
  }

  return (
    <FormItem name="headers" type="object" vertical>
      <Field<IInputsValues | undefined> name="headersValues">
        {({ field }) => (
          <InputsValues
            value={field.value}
            onChange={(value) => field.onChange(value)}
            readonly={readonly}
          />
        )}
      </Field>
    </FormItem>
  );
}
