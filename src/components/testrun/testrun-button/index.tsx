/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useState, useEffect, useCallback } from 'react';

import { Play } from 'lucide-react';
import { useClientContext, FlowNodeEntity } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { useTestRunFormPanel } from '../../../plugins/panel-manager-plugin/hooks';

export function TestRunButton(props: { disabled: boolean }) {
  const [errorCount, setErrorCount] = useState(0);
  const clientContext = useClientContext();
  const updateValidateData = useCallback(() => {
    const allForms = clientContext.document.getAllNodes().map((node) => node.form);
    const count = allForms.filter((form) => form?.state.invalid).length;
    setErrorCount(count);
  }, [clientContext]);
  const { open: openPanel } = useTestRunFormPanel();
  /**
   * Validate all node and Save
   */
  const onTestRun = useCallback(async () => {
    const allForms = clientContext.document.getAllNodes().map((node) => node.form);
    await Promise.all(allForms.map(async (form) => form?.validate()));
    console.log('>>>>> save data: ', clientContext.document.toJSON());
    openPanel();
  }, [clientContext]);

  /**
   * Listen single node validate
   */
  useEffect(() => {
    const listenSingleNodeValidate = (node: FlowNodeEntity) => {
      const { form } = node;
      if (form) {
        const formValidateDispose = form.onValidate(() => updateValidateData());
        node.onDispose(() => formValidateDispose.dispose());
      }
    };
    clientContext.document.getAllNodes().map((node) => listenSingleNodeValidate(node));
    const dispose = clientContext.document.onNodeCreate(({ node }) =>
      listenSingleNodeValidate(node)
    );
    return () => dispose.dispose();
  }, [clientContext]);

  return (
    <Button
      variant={errorCount ? 'destructive' : 'default'}
      disabled={props.disabled}
      onClick={onTestRun}
    >
      <Play /> Test Run{errorCount ? ` (${errorCount})` : ''}
    </Button>
  );
}
