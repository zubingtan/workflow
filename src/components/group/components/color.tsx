import { FC, useState } from 'react';

import { Field } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

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
    <div className="relative">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Group color"
        onClick={() => setOpen((current) => !current)}
      >
        <span
          className="size-4 rounded-full"
          style={{ backgroundColor: groupColors[value]['300'] }}
        />
      </Button>
      {open && (
        <div className="absolute top-full right-0 z-50 mt-1 grid grid-cols-4 gap-1 rounded-lg border border-border bg-popover p-2 shadow-xl">
          {Object.entries(groupColors).map(([name, color]) => (
            <button
              key={name}
              className="size-5 rounded-full border-2"
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
          ))}
        </div>
      )}
    </div>
  );
}
