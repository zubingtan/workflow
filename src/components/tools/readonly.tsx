import { useCallback } from 'react';

import { LockKeyhole, Unlock } from 'lucide-react';
import { usePlayground } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

export const Readonly = () => {
  const playground = usePlayground();
  const toggleReadonly = useCallback(() => {
    playground.config.readonly = !playground.config.readonly;
  }, [playground]);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={playground.config.readonly ? 'Editable' : 'Readonly'}
      aria-label={playground.config.readonly ? 'Editable' : 'Readonly'}
      onClick={toggleReadonly}
    >
      {playground.config.readonly ? <LockKeyhole /> : <Unlock />}
    </Button>
  );
};
