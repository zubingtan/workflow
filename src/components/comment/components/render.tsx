/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC } from 'react';

import {
  Field,
  FieldRenderProps,
  FlowNodeFormData,
  Form,
  FormModelV2,
  useNodeRender,
  WorkflowNodeEntity,
} from '@flowgram.ai/free-layout-editor';

import { useOverflow } from '../hooks/use-overflow';
import { useModel } from '../hooks/use-model';
import { useSize } from '../hooks';
import { CommentEditorFormField } from '../constant';
import { MoreButton } from './more-button';
import { CommentEditor } from './editor';
import { ContentDragArea } from './content-drag-area';
import { CommentContainer } from './container';
import { BorderArea } from './border-area';

export const CommentRender: FC<{
  node: WorkflowNodeEntity;
}> = (props) => {
  const { node } = props;
  const model = useModel();

  const { selected: focused, selectNode, nodeRef, deleteNode } = useNodeRender();

  const formModel = node.getData(FlowNodeFormData).getFormModel<FormModelV2>();
  const formControl = formModel?.formControl;

  const { width, height, onResize } = useSize();
  const { overflow, updateOverflow } = useOverflow({ model, height });

  return (
    <div
      className="workflow-comment"
      style={{
        width,
        height,
      }}
      ref={nodeRef}
      data-node-selected={String(focused)}
      onMouseEnter={updateOverflow}
      onMouseDown={(e) => {
        setTimeout(() => {
          // Prevent selectNode from intercepting the event, which would stop the slate editor from focusing
          selectNode(e);
        }, 20);
      }}
    >
      <Form control={formControl}>
        <>
          {/* Background */}
          <CommentContainer focused={focused} style={{ height }}>
            <Field name={CommentEditorFormField.Note}>
              {({ field }: FieldRenderProps<string>) => (
                <>
                  {/** Editor */}
                  <CommentEditor model={model} value={field.value} onChange={field.onChange} />
                  {/* Content drag area (hidden after click) */}
                  <ContentDragArea model={model} focused={focused} overflow={overflow} />
                  {/* More button */}
                  <MoreButton node={node} focused={focused} deleteNode={deleteNode} />
                </>
              )}
            </Field>
          </CommentContainer>
          {/* Border */}
          <BorderArea model={model} overflow={overflow} onResize={onResize} />
        </>
      </Form>
    </div>
  );
};
