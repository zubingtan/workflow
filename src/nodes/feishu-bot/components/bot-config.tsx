import { Field } from '@flowgram.ai/free-layout-editor';
import { Select, Typography } from '@douyinfe/semi-ui';

import { PromptEditorWithVariables } from '@/form-semantics/legacy-adapter';
import type { IFlowTemplateValue } from '@/form-semantics';

import { useNodeRenderContext, useIsSidebar } from '../../../hooks';
import { FormItem } from '../../../form-components';

/**
 * Bot type selector + mode-specific config.
 * - webhook: custom bot, only needs webhook URL (+ optional secret)
 * - app: app bot, needs appId/appSecret/receiveIdType/receiveId
 */
export function BotConfig() {
  const { readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
  const readonly_ = readonly || !isSidebar;

  return (
    <div>
      <FormItem name="Bot Type" required vertical type="string">
        <Field<string> name="botType" defaultValue="webhook">
          {({ field }) => (
            <Select
              value={field.value}
              onChange={(v) => field.onChange(v as string)}
              style={{ width: '100%' }}
              size="small"
              disabled={readonly_}
              optionList={[
                { label: 'Custom Bot (Webhook)', value: 'webhook' },
                { label: 'App Bot', value: 'app' },
              ]}
            />
          )}
        </Field>
      </FormItem>

      {/* Webhook mode config */}
      <Field<string> name="botType" defaultValue="webhook">
        {({ field: botTypeField }) =>
          botTypeField.value === 'webhook' ? (
            <div style={{ marginTop: 8 }}>
              <FormItem name="Webhook URL" required vertical type="string">
                <Field<IFlowTemplateValue> name="webhook.url">
                  {({ field }) => (
                    <PromptEditorWithVariables
                      disableMarkdownHighlight
                      readonly={readonly_}
                      style={{ flexGrow: 1 }}
                      placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/{token}"
                      value={field.value}
                      onChange={(v) => field.onChange(v!)}
                    />
                  )}
                </Field>
              </FormItem>
              <div style={{ marginTop: 8 }}>
                <Typography.Text size="small" strong>
                  Secret (optional, for signature verification)
                </Typography.Text>
                <Field<string> name="webhook.secret" defaultValue="">
                  {({ field }) => (
                    <input
                      type="password"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                      disabled={readonly_}
                      placeholder="Leave empty to skip signing"
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        fontSize: 12,
                        border: '1px solid var(--semi-color-border)',
                        borderRadius: 4,
                        marginTop: 4,
                      }}
                    />
                  )}
                </Field>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 8 }}>
                <Typography.Text size="small" strong>
                  App ID
                </Typography.Text>
                <Field<string> name="app.appId" defaultValue="">
                  {({ field }) => (
                    <input
                      type="text"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                      disabled={readonly_}
                      placeholder="cli_xxxxxxxxxxxx"
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        fontSize: 12,
                        border: '1px solid var(--semi-color-border)',
                        borderRadius: 4,
                        marginTop: 4,
                      }}
                    />
                  )}
                </Field>
              </div>
              <div style={{ marginBottom: 8 }}>
                <Typography.Text size="small" strong>
                  App Secret
                </Typography.Text>
                <Field<string> name="app.appSecret" defaultValue="">
                  {({ field }) => (
                    <input
                      type="password"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                      disabled={readonly_}
                      placeholder="App secret from developer console"
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        fontSize: 12,
                        border: '1px solid var(--semi-color-border)',
                        borderRadius: 4,
                        marginTop: 4,
                      }}
                    />
                  )}
                </Field>
              </div>
              <div style={{ marginBottom: 8 }}>
                <Typography.Text size="small" strong>
                  Receive ID Type
                </Typography.Text>
                <Field<string> name="app.receiveIdType" defaultValue="chat_id">
                  {({ field }) => (
                    <Select
                      value={field.value}
                      onChange={(v) => field.onChange(v as string)}
                      style={{ width: '100%', marginTop: 4 }}
                      size="small"
                      disabled={readonly_}
                      optionList={[
                        { label: 'Chat ID (group)', value: 'chat_id' },
                        { label: 'Open ID', value: 'open_id' },
                        { label: 'User ID', value: 'user_id' },
                        { label: 'Union ID', value: 'union_id' },
                        { label: 'Email', value: 'email' },
                      ]}
                    />
                  )}
                </Field>
              </div>
              <FormItem name="Receive ID" required vertical type="string">
                <Field<IFlowTemplateValue> name="inputsValues.receiveId">
                  {({ field }) => (
                    <PromptEditorWithVariables
                      disableMarkdownHighlight
                      readonly={readonly_}
                      style={{ flexGrow: 1 }}
                      placeholder="Recipient ID, use var by '{'"
                      value={field.value}
                      onChange={(v) => field.onChange(v!)}
                    />
                  )}
                </Field>
              </FormItem>
              <FormItem name="Reply Message ID" vertical type="string">
                <Field<IFlowTemplateValue> name="inputsValues.replyToMessageId">
                  {({ field }) => (
                    <PromptEditorWithVariables
                      disableMarkdownHighlight
                      readonly={readonly_}
                      style={{ flexGrow: 1 }}
                      placeholder="Original message ID, e.g. {{start_0.messageId}}"
                      value={field.value}
                      onChange={(v) => field.onChange(v!)}
                    />
                  )}
                </Field>
              </FormItem>
            </div>
          )
        }
      </Field>
    </div>
  );
}
