/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';

import { usePlayground, usePlaygroundTools } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

export const ZoomSelect = () => {
  const tools = usePlaygroundTools({ maxZoom: 2, minZoom: 0.25 });
  const playground = usePlayground();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-label="Zoom level"
      >
        {Math.floor(tools.zoom * 100)}%
      </Button>
      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-1 flex w-32 flex-col rounded-lg border border-border bg-popover p-1 shadow-md">
          <Button
            size="sm"
            variant="ghost"
            className="justify-start"
            onClick={() => tools.zoomin()}
          >
            Zoom in
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="justify-start"
            onClick={() => tools.zoomout()}
          >
            Zoom out
          </Button>
          {[0.5, 1, 1.5, 2].map((zoom) => (
            <Button
              key={zoom}
              size="sm"
              variant="ghost"
              className="justify-start"
              onClick={() => {
                playground.config.updateZoom(zoom);
                setOpen(false);
              }}
            >
              Zoom to {zoom * 100}%
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};
