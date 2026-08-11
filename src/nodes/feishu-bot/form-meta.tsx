import { FormMeta, FormRenderProps } from '@flowgram.ai/free-layout-editor';

import { DisplayOutputs } from '@/form-semantics';
import { createInferInputsPlugin } from '@/form-semantics';
import { Separator } from '@/components/ui';

import { FormHeader, FormContent } from '../../form-components';
import { FeishuBotNodeJSON } from './types';
import { MessageContent } from './components/message-content';
import { BotConfig } from './components/bot-config';
import { defaultFormMeta } from '../default-form-meta';

export const FormRender = ({ form }: FormRenderProps<FeishuBotNodeJSON>) => (
  <>
    <FormHeader />
    <FormContent>
      <BotConfig />
      <Separator />
      <MessageContent />
      <Separator />
      <DisplayOutputs displayFromScope />
    </FormContent>
  </>
);

export const formMeta: FormMeta = {
  render: (props) => <FormRender {...props} />,
  effect: defaultFormMeta.effect,
  validate: defaultFormMeta.validate,
  plugins: [createInferInputsPlugin({ sourceKey: 'inputsValues', targetKey: 'inputs' })],
};
