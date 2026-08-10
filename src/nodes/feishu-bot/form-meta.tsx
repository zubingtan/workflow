import { FormMeta, FormRenderProps } from '@flowgram.ai/free-layout-editor';
import { Divider } from '@douyinfe/semi-ui';

import { DisplayOutputs } from '@/form-semantics/legacy-adapter';
import { createInferInputsPlugin } from '@/form-semantics';

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
      <Divider />
      <MessageContent />
      <Divider />
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
