/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

export enum CommentEditorFormField {
  Size = 'size',
  Note = 'note',
}

/** Editor events */
export enum CommentEditorEvent {
  /** Init event */
  Init = 'init',
  /** Content change event */
  Change = 'change',
  /** Multi-select event */
  MultiSelect = 'multiSelect',
  /** Select event */
  Select = 'select',
  /** Blur event */
  Blur = 'blur',
}

export const CommentEditorDefaultValue = '';
