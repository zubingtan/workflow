/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import React from 'react';

import { DisplaySchemaTag } from '@/form-semantics';

import './index.css';

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
    <div
      style={{
        fontSize: 12,
        marginBottom: 6,
        width: '100%',
        position: 'relative',
        display: 'flex',
        gap: 8,
        ...(vertical
          ? { flexDirection: 'column' }
          : {
              justifyContent: 'center',
              alignItems: 'center',
            }),
        ...style,
      }}
    >
      <div
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          color: 'var(--app-color-text-3)',
          width: labelWidth || 118,
          minWidth: labelWidth || 118,
          maxWidth: labelWidth || 118,
          position: 'relative',
          display: 'flex',
          columnGap: 4,
          flexShrink: 0,
          ...labelStyle,
        }}
      >
        {type && <DisplaySchemaTag value={{ type }} />}
        <span className="min-w-0 flex-1 truncate" title={description || name}>
          {name}
          {required && <span className="pl-0.5 text-destructive">*</span>}
        </span>
      </div>

      <div
        style={{
          flexGrow: 1,
          minWidth: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
