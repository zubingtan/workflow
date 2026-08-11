/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useState } from 'react';

import { Field } from '@flowgram.ai/free-layout-editor';

import { Input } from '@/components/ui';

import { GroupField } from '../constant';

export const GroupTitle: FC = () => {
  const [inputting, setInputting] = useState(false);
  return (
    <Field<string> name={GroupField.Title}>
      {({ field }) =>
        inputting ? (
          <Input
            autoFocus
            aria-label="Group title"
            className="h-7 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
            value={field.value}
            onChange={(event) => field.onChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onBlur={() => setInputting(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') setInputting(false);
            }}
          />
        ) : (
          <p className="workflow-group-title" onDoubleClick={() => setInputting(true)}>
            {field.value ?? 'Group'}
          </p>
        )
      }
    </Field>
  );
};
