/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useState } from 'react';

import { usePlayground, usePlaygroundTools } from '@flowgram.ai/free-layout-editor';

import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui';

import { ToolbarTooltip } from './toolbar-tooltip';

export const ZoomSelect = () => {
  const tools = usePlaygroundTools({ maxZoom: 2, minZoom: 0.25 });
  const playground = usePlayground();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <ToolbarTooltip label="Zoom level">
        <PopoverTrigger
          render={
            <Button variant="ghost" size="sm" aria-label="Zoom level">
              {Math.floor(tools.zoom * 100)}%
            </Button>
          }
        />
      </ToolbarTooltip>
      <PopoverContent
        side="top"
        align="start"
        className="w-32 p-1 backdrop-blur-md"
        positionerClassName="isolate z-[1200]"
      >
        <PopoverTitle className="sr-only">Zoom options</PopoverTitle>
        <div className="flex flex-col gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="justify-start"
            onClick={() => {
              tools.zoomin();
              setOpen(false);
            }}
          >
            Zoom in
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="justify-start"
            onClick={() => {
              tools.zoomout();
              setOpen(false);
            }}
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
      </PopoverContent>
    </Popover>
  );
};
