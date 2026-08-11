import { Field, FormMeta, FormRenderProps } from '@flowgram.ai/free-layout-editor';

import { DisplayOutputs } from '@/form-semantics';
import { Input, Select, Separator } from '@/components/ui';

import { defaultFormMeta } from '../default-form-meta';
import { useIsSidebar, useNodeRenderContext } from '../../hooks';
import { FormContent, FormHeader, FormItem } from '../../form-components';
import { FeishuTriggerNodeJSON } from './types';

function TextField({
  name,
  label,
  placeholder,
  type = 'text',
  readonly,
}: {
  name: string;
  label: string;
  placeholder?: string;
  type?: string;
  readonly: boolean;
}) {
  return (
    <Field<string> name={name} defaultValue="">
      {({ field }) => (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">{label}</label>
          <Input
            type={type}
            value={field.value ?? ''}
            onChange={(event) => field.onChange(event.target.value)}
            disabled={readonly}
            placeholder={placeholder}
          />
        </div>
      )}
    </Field>
  );
}

function NumberField({
  name,
  label,
  min,
  readonly,
}: {
  name: string;
  label: string;
  min: number;
  readonly: boolean;
}) {
  return (
    <Field<number> name={name}>
      {({ field }) => (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium">{label}</label>
          <Input
            type="number"
            min={min}
            value={field.value ?? min}
            onChange={(event) => field.onChange(Number(event.target.value))}
            disabled={readonly}
          />
        </div>
      )}
    </Field>
  );
}

export const FormRender = ({ form }: FormRenderProps<FeishuTriggerNodeJSON>) => {
  const { readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
  const readonly_ = readonly || !isSidebar;

  return (
    <>
      <FormHeader />
      <FormContent>
        <FormItem name="Enabled" vertical type="boolean">
          <Field<boolean> name="enabled" defaultValue>
            {({ field }) => (
              <input
                type="checkbox"
                aria-label="Enabled"
                checked={field.value !== false}
                onChange={(event) => field.onChange(event.target.checked)}
                disabled={readonly_}
              />
            )}
          </Field>
        </FormItem>
        <Separator />
        <TextField
          name="appId"
          label="App ID"
          placeholder="cli_xxxxxxxxxxxx"
          readonly={readonly_}
        />
        <TextField
          name="appSecret"
          label="App Secret"
          type="password"
          placeholder="Used to fetch Feishu context"
          readonly={readonly_}
        />
        <Separator />
        <FormItem name="Only When Mentioned" vertical type="boolean">
          <Field<boolean> name="onlyWhenMentioned" defaultValue>
            {({ field }) => (
              <input
                type="checkbox"
                aria-label="Only When Mentioned"
                checked={field.value !== false}
                onChange={(event) => field.onChange(event.target.checked)}
                disabled={readonly_}
              />
            )}
          </Field>
        </FormItem>
        <TextField
          name="chatIdAllowlist"
          label="Chat ID Allowlist"
          placeholder="Comma separated; empty means all chats"
          readonly={readonly_}
        />
        <FormItem name="Context Mode" required vertical type="string">
          <Field<string> name="contextMode" defaultValue="auto">
            {({ field }) => (
              <Select
                value={field.value}
                onChange={(event) => field.onChange(event.currentTarget.value)}
                disabled={readonly_}
              >
                <option value="auto">Auto</option>
                <option value="thread">Thread replies</option>
                <option value="chat_window">Chat time window</option>
              </Select>
            )}
          </Field>
        </FormItem>
        <NumberField name="maxMessages" label="Max Messages" min={1} readonly={readonly_} />
        <NumberField name="windowMinutes" label="Window Minutes" min={1} readonly={readonly_} />
        <Separator />
        <DisplayOutputs displayFromScope />
      </FormContent>
    </>
  );
};

export const formMeta: FormMeta = {
  render: (props) => <FormRender {...props} />,
  effect: defaultFormMeta.effect,
};
