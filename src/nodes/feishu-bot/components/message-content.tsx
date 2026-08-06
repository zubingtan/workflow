import { Field } from '@flowgram.ai/free-layout-editor';
import {
  IFlowTemplateValue,
  JsonEditorWithVariables,
  PromptEditorWithVariables,
} from '@flowgram.ai/form-materials';
import { Select, Typography } from '@douyinfe/semi-ui';

import { useNodeRenderContext, useIsSidebar } from '../../../hooks';
import { FormItem } from '../../../form-components';

const MSG_TYPE_OPTIONS = [
  { label: 'Text', value: 'text' },
  { label: 'Rich Text (Post)', value: 'post' },
  { label: 'Interactive Card', value: 'interactive' },
];

/**
 * Message type selector + type-specific content editor.
 * - text: simple text editor with variable support
 * - post: JSON editor for rich text post structure
 * - interactive: JSON editor for card structure
 */
export function MessageContent() {
  const { readonly } = useNodeRenderContext();
  const isSidebar = useIsSidebar();
  const readonly_ = readonly || !isSidebar;

  const renderContentEditor = (msgType: string) => {
    switch (msgType) {
      case 'text':
        return (
          <Field<IFlowTemplateValue> name="inputsValues.textContent">
            {({ field }) => (
              <PromptEditorWithVariables
                readonly={readonly_}
                style={{ flexGrow: 1, minHeight: 60 }}
                placeholder="Message text, use var by '{'"
                value={field.value}
                onChange={(v) => field.onChange(v!)}
              />
            )}
          </Field>
        );
      case 'post':
        return (
          <Field<IFlowTemplateValue> name="inputsValues.postContent">
            {({ field }) => (
              <JsonEditorWithVariables
                value={field.value?.content}
                readonly={readonly_}
                activeLinePlaceholder="use var by '@'"
                onChange={(value) => {
                  field.onChange({ type: 'template', content: value });
                }}
              />
            )}
          </Field>
        );
      case 'interactive':
        return (
          <Field<IFlowTemplateValue> name="inputsValues.cardContent">
            {({ field }) => (
              <JsonEditorWithVariables
                value={field.value?.content}
                readonly={readonly_}
                activeLinePlaceholder="use var by '@'"
                onChange={(value) => {
                  field.onChange({ type: 'template', content: value });
                }}
              />
            )}
          </Field>
        );
      default:
        return null;
    }
  };

  return (
    <Field<string> name="msgType" defaultValue="text">
      {({ field }) => (
        <div>
          <FormItem name="Message Type" required vertical type="string">
            <Select
              value={field.value}
              onChange={(v) => field.onChange(v as string)}
              style={{ width: '100%', marginBottom: 10 }}
              size="small"
              disabled={readonly_}
              optionList={MSG_TYPE_OPTIONS}
            />
            <div style={{ marginTop: 4 }}>
              <Typography.Text size="small" strong>
                Content
              </Typography.Text>
              <div style={{ marginTop: 4 }}>{renderContentEditor(field.value)}</div>
            </div>
          </FormItem>
        </div>
      )}
    </Field>
  );
}
