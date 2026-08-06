import { Field, FormMeta, FormRenderProps } from '@flowgram.ai/free-layout-editor';
import { DisplayOutputs } from '@flowgram.ai/form-materials';
import { Divider, Select, Switch, Typography } from '@douyinfe/semi-ui';

import { defaultFormMeta } from '../default-form-meta';
import { useIsSidebar, useNodeRenderContext } from '../../hooks';
import { FormContent, FormHeader, FormItem } from '../../form-components';
import { FeishuTriggerNodeJSON } from './types';

const inputStyle = {
  width: '100%',
  padding: '4px 8px',
  fontSize: 12,
  border: '1px solid var(--semi-color-border)',
  borderRadius: 4,
  marginTop: 4,
};

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
    <div style={{ marginBottom: 8 }}>
      <Typography.Text size="small" strong>
        {label}
      </Typography.Text>
      <Field<string> name={name} defaultValue="">
        {({ field }) => (
          <input
            type={type}
            value={field.value ?? ''}
            onChange={(e) => field.onChange(e.target.value)}
            disabled={readonly}
            placeholder={placeholder}
            style={inputStyle}
          />
        )}
      </Field>
    </div>
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
    <div style={{ marginBottom: 8 }}>
      <Typography.Text size="small" strong>
        {label}
      </Typography.Text>
      <Field<number> name={name}>
        {({ field }) => (
          <input
            type="number"
            min={min}
            value={field.value ?? min}
            onChange={(e) => field.onChange(Number(e.target.value))}
            disabled={readonly}
            style={inputStyle}
          />
        )}
      </Field>
    </div>
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
              <Switch
                checked={field.value !== false}
                onChange={field.onChange}
                disabled={readonly_}
              />
            )}
          </Field>
        </FormItem>
        <Divider />
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
        <Divider />
        <FormItem name="Only When Mentioned" vertical type="boolean">
          <Field<boolean> name="onlyWhenMentioned" defaultValue>
            {({ field }) => (
              <Switch
                checked={field.value !== false}
                onChange={field.onChange}
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
                onChange={(v) => field.onChange(v as string)}
                style={{ width: '100%' }}
                size="small"
                disabled={readonly_}
                optionList={[
                  { label: 'Auto', value: 'auto' },
                  { label: 'Thread replies', value: 'thread' },
                  { label: 'Chat time window', value: 'chat_window' },
                ]}
              />
            )}
          </Field>
        </FormItem>
        <NumberField name="maxMessages" label="Max Messages" min={1} readonly={readonly_} />
        <NumberField name="windowMinutes" label="Window Minutes" min={1} readonly={readonly_} />
        <Divider />
        <DisplayOutputs displayFromScope />
      </FormContent>
    </>
  );
};

export const formMeta: FormMeta = {
  render: (props) => <FormRender {...props} />,
  effect: defaultFormMeta.effect,
};
