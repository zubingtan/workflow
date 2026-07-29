/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { type FC } from 'react';

import type { CommentEditorModel } from '../model';
import { ResizeArea } from './resize-area';
import { DragArea } from './drag-area';

interface IBorderArea {
  model: CommentEditorModel;
  overflow: boolean;
  onResize?: () => {
    resizing: (delta: { top: number; right: number; bottom: number; left: number }) => void;
    resizeEnd: () => void;
  };
}

export const BorderArea: FC<IBorderArea> = (props) => {
  const { model, overflow, onResize } = props;

  return (
    <div style={{ zIndex: 999 }}>
      {/* Left */}
      <DragArea
        style={{
          position: 'absolute',
          left: -10,
          top: 10,
          width: 20,
          height: 'calc(100% - 20px)',
        }}
        model={model}
      />
      {/* Right */}
      <DragArea
        style={{
          position: 'absolute',
          right: -10,
          top: 10,
          height: 'calc(100% - 20px)',
          width: overflow ? 10 : 20, // Avoid covering the scrollbar
        }}
        model={model}
      />
      {/* Top */}
      <DragArea
        style={{
          position: 'absolute',
          top: -10,
          left: 10,
          width: 'calc(100% - 20px)',
          height: 20,
        }}
        model={model}
      />
      {/* Bottom */}
      <DragArea
        style={{
          position: 'absolute',
          bottom: -10,
          left: 10,
          width: 'calc(100% - 20px)',
          height: 20,
        }}
        model={model}
      />
      {/** Top-left corner */}
      <ResizeArea
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          cursor: 'nwse-resize',
        }}
        model={model}
        getDelta={({ x, y }) => ({ top: y, right: 0, bottom: 0, left: x })}
        onResize={onResize}
      />
      {/** Top-right corner */}
      <ResizeArea
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          cursor: 'nesw-resize',
        }}
        model={model}
        getDelta={({ x, y }) => ({ top: y, right: x, bottom: 0, left: 0 })}
        onResize={onResize}
      />
      {/** Bottom-right corner */}
      <ResizeArea
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          cursor: 'nwse-resize',
        }}
        model={model}
        getDelta={({ x, y }) => ({ top: 0, right: x, bottom: y, left: 0 })}
        onResize={onResize}
      />
      {/** Bottom-left corner */}
      <ResizeArea
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          cursor: 'nesw-resize',
        }}
        model={model}
        getDelta={({ x, y }) => ({ top: 0, right: 0, bottom: y, left: x })}
        onResize={onResize}
      />
    </div>
  );
};
