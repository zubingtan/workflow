import { Field } from '@flowgram.ai/free-layout-editor';

import { JsonEditorWithVariables, PromptEditorWithVariables } from '@/form-semantics';
import type { IFlowTemplateValue } from '@/form-semantics';
import { Select } from '@/components/ui';

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
              onChange={(event) => field.onChange(event.currentTarget.value)}
              className="mb-2"
              disabled={readonly_}
            >
              {MSG_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <div style={{ marginTop: 4 }}>
              <label className="text-xs font-medium">Content</label>
              <div style={{ marginTop: 4 }}>{renderContentEditor(field.value)}</div>
            </div>
          </FormItem>
        </div>
      )}
    </Field>
  );
}
