/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import React from 'react';

import { cn } from '@/lib/utils';
import { DisplaySchemaTag } from '@/form-semantics';
import { Field, FieldContent, FieldLabel } from '@/components/ui';

interface FormItemProps {
  children: React.ReactNode;
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
  labelWidth?: number;
  labelStyle?: React.CSSProperties;
  vertical?: boolean;
  style?: React.CSSProperties;
}
export function FormItem({
  children,
  name,
  required,
  description,
  type,
  labelWidth,
  labelStyle,
  vertical,
  style,
}: FormItemProps): JSX.Element {
  return (
    <Field
      orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn('mb-[var(--app-space-2)] min-w-0', !vertical && 'items-center')}
      style={style}
    >
      <FieldLabel
        className={cn('min-w-0 text-xs font-medium text-muted-foreground', !vertical && 'shrink-0')}
        style={
          labelWidth
            ? {
                width: labelWidth,
                minWidth: labelWidth,
                maxWidth: labelWidth,
                ...labelStyle,
              }
            : labelStyle
        }
        title={description || name}
      >
        {type && <DisplaySchemaTag value={{ type }} />}
        <span className="min-w-0 flex-1 truncate" title={description || name}>
          {name}
          {required && <span className="pl-0.5 text-destructive">*</span>}
        </span>
      </FieldLabel>
      <FieldContent className="min-w-0">{children}</FieldContent>
    </Field>
  );
}
