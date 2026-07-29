/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback, useState, useEffect } from 'react';

import { usePlayground } from '@flowgram.ai/free-layout-editor';

import { CommentEditorModel } from '../model';
import { CommentEditorEvent } from '../constant';

export const useOverflow = (params: { model: CommentEditorModel; height: number }) => {
  const { model, height } = params;
  const playground = usePlayground();

  const [overflow, setOverflow] = useState(false);

  const isOverflow = useCallback((): boolean => {
    if (!model.element) {
      return false;
    }
    return model.element.scrollHeight > model.element.clientHeight;
  }, [model, height, playground]);

  // Update overflow state
  const updateOverflow = useCallback(() => {
    setOverflow(isOverflow());
  }, [isOverflow]);

  // Listen for height changes
  useEffect(() => {
    updateOverflow();
  }, [height, updateOverflow]);

  // Listen for change events
  useEffect(() => {
    const changeDisposer = model.on((params) => {
      if (params.type !== CommentEditorEvent.Change && params.type !== CommentEditorEvent.Init) {
        return;
      }
      updateOverflow();
    });
    return () => {
      changeDisposer.dispose();
    };
  }, [model, updateOverflow]);

  return { overflow, updateOverflow };
};
