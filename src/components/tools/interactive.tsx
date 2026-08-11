/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useEffect, useState } from 'react';

import { MousePointer2, Tablet } from 'lucide-react';
import {
  usePlaygroundTools,
  type InteractiveType as IdeInteractiveType,
} from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

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
  const next =
    interactiveType === InteractiveType.Mouse ? InteractiveType.Pad : InteractiveType.Mouse;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={
        interactiveType === InteractiveType.Mouse ? 'Mouse friendly' : 'Touchpad friendly'
      }
      onClick={() => {
        setInteractiveType(next);
        setPreferInteractiveType(next);
      }}
      title="Switch interaction mode"
    >
      {interactiveType === InteractiveType.Mouse ? <MousePointer2 /> : <Tablet />}
    </Button>
  );
};
