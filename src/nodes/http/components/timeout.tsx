/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Field } from '@flowgram.ai/free-layout-editor';

import { Input } from '@/components/ui';

import { useNodeRenderContext } from '../../../hooks';
import { FormItem } from '../../../form-components';

export function Timeout() {
  const { readonly } = useNodeRenderContext();

  return (
    <div>
      <FormItem name="Timeout(ms)" required style={{ flex: 1 }} type="number">
        <Field<number> name="timeout.timeout" defaultValue={10000}>
          {({ field }) => (
            <Input
              type="number"
              value={field.value}
              onChange={(event) => field.onChange(Number(event.target.value))}
              disabled={readonly}
              min={0}
            />
          )}
        </Field>
      </FormItem>
      <FormItem name="Retry Times" required type="number">
        <Field<number> name="timeout.retryTimes" defaultValue={1}>
          {({ field }) => (
            <Input
              type="number"
              value={field.value}
              onChange={(event) => field.onChange(Number(event.target.value))}
              disabled={readonly}
              min={0}
            />
          )}
        </Field>
      </FormItem>
    </div>
  );
}
