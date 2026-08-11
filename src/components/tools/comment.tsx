/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useCallback } from 'react';

import { MessageSquare } from 'lucide-react';
import {
  delay,
  usePlayground,
  useService,
  WorkflowDocument,
  WorkflowDragService,
  WorkflowSelectService,
} from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { WorkflowNodeType } from '../../nodes';

export const Comment = () => {
  const playground = usePlayground();
  const document = useService(WorkflowDocument);
  const selectService = useService(WorkflowSelectService);
  const dragService = useService(WorkflowDragService);
  const createComment = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      const mousePosition = playground.config.getPosFromMouseEvent(event);
      const node = document.createWorkflowNodeByType(WorkflowNodeType.Comment, {
        x: mousePosition.x,
        y: mousePosition.y - 75,
      });
      await delay(16);
      selectService.selectNode(node);
      if (event.detail !== 0) dragService.startDragSelectedNodes(event);
    },
    [document, dragService, playground, selectService]
  );
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={playground.config.readonly}
      onClick={createComment}
      aria-label="Comment"
    >
      <MessageSquare />
    </Button>
  );
};
