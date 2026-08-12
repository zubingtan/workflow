/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState, type ReactNode } from 'react';

import { MousePointer2, Tablet } from 'lucide-react';
import {
  usePlaygroundTools,
  type InteractiveType as IdeInteractiveType,
} from '@flowgram.ai/free-layout-editor';

import { Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui';

import { ToolbarTooltip } from './toolbar-tooltip';

export const CACHE_KEY = 'workflow_prefer_interactive_type';
export const IS_MAC_OS = /(Macintosh|MacIntel|MacPPC|Mac68K|iPad)/.test(navigator.userAgent);
export enum InteractiveType {
  Mouse = 'MOUSE',
  Pad = 'PAD',
}
export const getPreferInteractiveType = () => {
  const value = localStorage.getItem(CACHE_KEY);
  return value === InteractiveType.Mouse || value === InteractiveType.Pad
    ? value
    : IS_MAC_OS
    ? InteractiveType.Pad
    : InteractiveType.Mouse;
};
export const setPreferInteractiveType = (type: InteractiveType) =>
  localStorage.setItem(CACHE_KEY, type);

export const Interactive = () => {
  const tools = usePlaygroundTools();
  const [interactiveType, setInteractiveType] = useState<InteractiveType>(
    () => getPreferInteractiveType() as InteractiveType
  );
  useEffect(() => {
    tools.setInteractiveType(interactiveType as unknown as IdeInteractiveType);
  }, [interactiveType, tools]);
  return (
    <Popover modal={false}>
      <ToolbarTooltip label="Interaction mode">
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Interaction mode">
              {interactiveType === InteractiveType.Mouse ? <MousePointer2 /> : <Tablet />}
            </Button>
          }
        />
      </ToolbarTooltip>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 p-2"
        positionerClassName="isolate z-[1200]"
      >
        <PopoverTitle className="px-2 py-1 text-sm">Interaction mode</PopoverTitle>
        <div className="flex flex-col gap-1" role="group" aria-label="Interaction mode options">
          <InteractionOption
            value={InteractiveType.Mouse}
            selected={interactiveType === InteractiveType.Mouse}
            icon={<MousePointer2 />}
            title="Mouse-Friendly"
            description="Drag the canvas with the left mouse button, zoom with the scroll wheel."
            onSelect={(value) => {
              setInteractiveType(value);
              setPreferInteractiveType(value);
            }}
          />
          <InteractionOption
            value={InteractiveType.Pad}
            selected={interactiveType === InteractiveType.Pad}
            icon={<Tablet />}
            title="Touchpad-Friendly"
            description="Drag with two fingers and zoom by pinching or spreading two fingers."
            onSelect={(value) => {
              setInteractiveType(value);
              setPreferInteractiveType(value);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};

function InteractionOption({
  value,
  selected,
  icon,
  title,
  description,
  onSelect,
}: {
  value: InteractiveType;
  selected: boolean;
  icon: ReactNode;
  title: string;
  description: string;
  onSelect: (value: InteractiveType) => void;
}) {
  return (
    <Button
      type="button"
      variant={selected ? 'secondary' : 'ghost'}
      className="h-auto min-h-14 justify-start gap-2 px-2 py-2 text-left"
      aria-pressed={selected}
      onClick={() => onSelect(value)}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium">{title}</span>
        <span className="mt-0.5 block whitespace-normal text-[11px] leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </Button>
  );
}
