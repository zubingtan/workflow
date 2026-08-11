import { useCallback } from 'react';

import { GitBranch } from 'lucide-react';
import { useService, WorkflowLinesManager } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

export const SwitchLine = () => {
  const linesManager = useService(WorkflowLinesManager);
  const switchLine = useCallback(() => linesManager.switchLineType(), [linesManager]);
  return (
    <Button variant="ghost" size="icon-sm" onClick={switchLine} aria-label="Switch line">
      <GitBranch />
    </Button>
  );
};
