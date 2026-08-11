import { Maximize2 } from 'lucide-react';
import { usePlaygroundTools } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

export const FitView = () => {
  const tools = usePlaygroundTools();
  return (
    <Button variant="ghost" size="icon-sm" onClick={() => tools.fitView()} aria-label="Fit view">
      <Maximize2 />
    </Button>
  );
};
