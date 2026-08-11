import { Field } from '@flowgram.ai/free-layout-editor';

import { PromptEditorWithVariables } from '@/form-semantics';
import type { IFlowTemplateValue } from '@/form-semantics';
import { Select } from '@/components/ui';

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
              onChange={(event) => field.onChange(event.currentTarget.value)}
              disabled={readonly_}
            >
              <option value="webhook">Custom Bot (Webhook)</option>
              <option value="app">App Bot</option>
            </Select>
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
                <label className="text-xs font-medium">
                  Secret (optional, for signature verification)
                </label>
                <Field<string> name="webhook.secret" defaultValue="">
                  {({ field }) => (
                    <input
                      type="password"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                      disabled={readonly_}
                      placeholder="Leave empty to skip signing"
                      className="mt-1"
                    />
                  )}
                </Field>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 8 }}>
                <label className="text-xs font-medium">App ID</label>
                <Field<string> name="app.appId" defaultValue="">
                  {({ field }) => (
                    <input
                      type="text"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                      disabled={readonly_}
                      placeholder="cli_xxxxxxxxxxxx"
                      className="mt-1"
                    />
                  )}
                </Field>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label className="text-xs font-medium">App Secret</label>
                <Field<string> name="app.appSecret" defaultValue="">
                  {({ field }) => (
                    <input
                      type="password"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                      disabled={readonly_}
                      placeholder="App secret from developer console"
                      className="mt-1"
                    />
                  )}
                </Field>
              </div>
              <div style={{ marginBottom: 8 }}>
                <label className="text-xs font-medium">Receive ID Type</label>
                <Field<string> name="app.receiveIdType" defaultValue="chat_id">
                  {({ field }) => (
                    <Select
                      value={field.value}
                      onChange={(event) => field.onChange(event.currentTarget.value)}
                      className="mt-1"
                      disabled={readonly_}
                    >
                      <option value="chat_id">Chat ID (group)</option>
                      <option value="open_id">Open ID</option>
                      <option value="user_id">User ID</option>
                      <option value="union_id">Union ID</option>
                      <option value="email">Email</option>
                    </Select>
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
