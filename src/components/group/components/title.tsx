import { FC, useState } from 'react';

import { Field } from '@flowgram.ai/free-layout-editor';

import { Input } from '@/components/ui';

import { GroupField } from '../constant';

export const GroupTitle: FC = () => {
  const [inputting, setInputting] = useState(false);
  return (
    <Field<string> name={GroupField.Title}>
      {({ field }) =>
        inputting ? (
          <Input
            autoFocus
            value={field.value}
            onChange={(event) => field.onChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onBlur={() => setInputting(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') setInputting(false);
            }}
          />
        ) : (
          <p className="workflow-group-title" onDoubleClick={() => setInputting(true)}>
            {field.value ?? 'Group'}
          </p>
        )
      }
    </Field>
  );
};
