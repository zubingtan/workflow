/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { FC, useState } from 'react';

import { Field } from '@flowgram.ai/free-layout-editor';

import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui';

import { GroupField } from '../constant';
import { defaultColor, groupColors } from '../color';

export const GroupColor: FC = () => (
  <Field<string> name={GroupField.Color}>
    {({ field }) => <ColorPicker value={field.value ?? defaultColor} onChange={field.onChange} />}
  </Field>
);

function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Group color" aria-expanded={open}>
            <span
              className="size-4 rounded-full"
              style={{ backgroundColor: groupColors[value]['300'] }}
            />
          </Button>
        }
      />
      <PopoverContent side="top" align="end" className="w-auto p-2">
        <PopoverTitle className="sr-only">Group color</PopoverTitle>
        <TooltipProvider>
          <div className="grid grid-cols-4 gap-1">
            {Object.entries(groupColors).map(([name, color]) => (
              <Tooltip key={name}>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-pressed={name === value}
                      className="size-6 rounded-full border-2 transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      style={{
                        backgroundColor: color['300'],
                        borderColor: name === value ? color['400'] : 'transparent',
                      }}
                      aria-label={name}
                      onClick={() => {
                        onChange(name);
                        setOpen(false);
                      }}
                    />
                  }
                />
                <TooltipContent>{name}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
