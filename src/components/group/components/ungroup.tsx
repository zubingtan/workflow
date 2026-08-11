import { CSSProperties, FC } from 'react';

import { Ungroup } from 'lucide-react';
import { CommandRegistry, useService, WorkflowNodeEntity } from '@flowgram.ai/free-layout-editor';
import { WorkflowGroupCommand } from '@flowgram.ai/free-group-plugin';

import { Button } from '@/components/ui';

export const UngroupButton: FC<{ node: WorkflowNodeEntity; style?: CSSProperties }> = ({
  node,
  style,
}) => {
  const commandRegistry = useService(CommandRegistry);
  return (
    <div className="workflow-group-ungroup" style={style}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Ungroup"
        onClick={() => commandRegistry.executeCommand(WorkflowGroupCommand.Ungroup, node)}
      >
        <Ungroup />
      </Button>
    </div>
  );
};
