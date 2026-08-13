/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { Field, FormMeta } from '@flowgram.ai/free-layout-editor';

import { DisplayInputsValues, InputsValues } from '@/form-semantics';
import { createInferInputsPlugin } from '@/form-semantics';
import type { IInputsValues } from '@/form-semantics';

import { defaultFormMeta } from '../default-form-meta';
import { useIsSidebar } from '../../hooks';
import { FormHeader, FormContent } from '../../form-components';

export const renderForm = () => {
  const isSidebar = useIsSidebar();
  if (isSidebar) {
    return (
      <>
        <FormHeader />
        <FormContent>
          <Field<IInputsValues | undefined> name="inputsValues">
            {({ field: { value, onChange } }) => (
              <>
                <InputsValues value={value} onChange={(_v) => onChange(_v)} />
              </>
            )}
          </Field>
        </FormContent>
      </>
    );
  }
  return (
    <>
      <FormHeader />
      <FormContent>
        <Field<IInputsValues | undefined> name="inputsValues">
          {({ field: { value } }) => (
            <>
              <DisplayInputsValues value={value} />
            </>
          )}
        </Field>
      </FormContent>
    </>
  );
};

export const formMeta: FormMeta = {
  ...defaultFormMeta,
  render: renderForm,
  plugins: [
    createInferInputsPlugin({
      sourceKey: 'inputsValues',
      targetKey: 'inputs',
    }),
  ],
};
