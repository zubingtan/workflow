/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useRef, useEffect } from 'react';

import { Field, FieldRenderProps } from '@flowgram.ai/free-layout-editor';

import { Input } from '@/components/ui';

import { Title } from './styles';
import { Feedback } from '../feedback';

export function TitleInput(props: {
  readonly: boolean;
  titleEdit: boolean;
  updateTitleEdit: (setEdit: boolean) => void;
}): JSX.Element {
  const { readonly, titleEdit, updateTitleEdit } = props;
  const ref = useRef<any>();
  const titleEditing = titleEdit && !readonly;
  useEffect(() => {
    if (titleEditing) {
      ref.current?.focus();
    }
  }, [titleEditing]);

  return (
    <Title>
      <Field name="title">
        {({ field: { value, onChange }, fieldState }: FieldRenderProps<string>) => (
          <div
            style={{ height: 24 }}
            onDoubleClick={() => {
              if (!readonly) updateTitleEdit(true);
            }}
          >
            {titleEditing ? (
              <Input
                value={value}
                onChange={onChange}
                ref={ref}
                onBlur={() => updateTitleEdit(false)}
              />
            ) : (
              <span className="block truncate text-xs font-semibold" title={value}>
                {value}
              </span>
            )}
            <Feedback errors={fieldState?.errors} />
          </div>
        )}
      </Field>
    </Title>
  );
}
