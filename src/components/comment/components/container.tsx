/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import type { ReactNode, FC, CSSProperties } from 'react';

interface ICommentContainer {
  focused: boolean;
  children?: ReactNode;
  style?: React.CSSProperties;
}

export const CommentContainer: FC<ICommentContainer> = (props) => {
  const { focused, children, style } = props;

  const scrollbarStyle = {
    // Scrollbar style
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--app-color-text-3) transparent',
    // Styles for WebKit browsers (e.g. Chrome, Safari)
    '&:WebkitScrollbar': {
      width: '4px',
    },
    '&::WebkitScrollbarTrack': {
      background: 'transparent',
    },
    '&::WebkitScrollbarThumb': {
      backgroundColor: 'var(--app-color-text-3)',
      borderRadius: '20px',
      border: '2px solid transparent',
    },
  } as unknown as CSSProperties;

  return (
    <div
      className="workflow-comment-container"
      data-flow-editor-selectable="false"
      style={{
        // Tailwind does not support outline styles, so use inline style here
        outline: focused
          ? '1px solid var(--semi-color-warning-hover)'
          : '1px solid var(--semi-color-warning)',
        backgroundColor: 'var(--semi-color-warning-light-default)',
        ...scrollbarStyle,
        ...style,
      }}
    >
      {children}
    </div>
  );
};
