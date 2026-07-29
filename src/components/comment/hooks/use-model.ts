/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useMemo } from 'react';

import {
  FlowNodeFormData,
  FormModelV2,
  useEntityFromContext,
  useNodeRender,
  WorkflowNodeEntity,
} from '@flowgram.ai/free-layout-editor';

import { CommentEditorModel } from '../model';
import { CommentEditorFormField } from '../constant';

export const useModel = () => {
  const node = useEntityFromContext<WorkflowNodeEntity>();
  const { selected: focused } = useNodeRender();

  const formModel = node.getData(FlowNodeFormData).getFormModel<FormModelV2>();

  const model = useMemo(() => new CommentEditorModel(), []);

  // Sync the blur state
  useEffect(() => {
    if (focused) {
      return;
    }
    model.setFocus(focused);
  }, [focused, model]);

  // Sync form value initialization
  useEffect(() => {
    const value = formModel.getValueIn<string>(CommentEditorFormField.Note);
    model.setInitValue(value); // Set initial value
    model.selectEnd(); // Set initial cursor position
  }, [formModel, model]);

  // Sync external form value changes: undo/redo/collaboration
  useEffect(() => {
    const disposer = formModel.onFormValuesChange(({ name }) => {
      if (name !== CommentEditorFormField.Note && name !== '') {
        return;
      }
      const value = formModel.getValueIn<string>(CommentEditorFormField.Note);
      model.setValue(value);
    });
    return () => disposer.dispose();
  }, [formModel, model]);

  return model;
};
