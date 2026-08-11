import { useCallback, useEffect, useState } from 'react';

import { Save as SaveIcon } from 'lucide-react';
import { useClientContext, FlowNodeEntity } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

export function Save(props: { disabled: boolean }) {
  const [errorCount, setErrorCount] = useState(0);
  const clientContext = useClientContext();
  const updateValidateData = useCallback(() => {
    const allForms = clientContext.document.getAllNodes().map((node) => node.form);
    setErrorCount(allForms.filter((form) => form?.state.invalid).length);
  }, [clientContext]);
  const onSave = useCallback(async () => {
    const allForms = clientContext.document.getAllNodes().map((node) => node.form);
    await Promise.all(allForms.map(async (form) => form?.validate()));
    updateValidateData();
  }, [clientContext, updateValidateData]);
  useEffect(() => {
    const listen = (node: FlowNodeEntity) => {
      if (!node.form) return;
      const dispose = node.form.onValidate(updateValidateData);
      node.onDispose(() => dispose.dispose());
    };
    clientContext.document.getAllNodes().forEach(listen);
    const dispose = clientContext.document.onNodeCreate(({ node }) => listen(node));
    return () => dispose.dispose();
  }, [clientContext, updateValidateData]);
  return (
    <Button
      variant={errorCount ? 'destructive' : 'outline'}
      disabled={props.disabled}
      onClick={onSave}
      style={{ color: 'var(--app-color-text-1)' }}
    >
      <SaveIcon /> Save{errorCount ? ` (${errorCount})` : ''}
    </Button>
  );
}
