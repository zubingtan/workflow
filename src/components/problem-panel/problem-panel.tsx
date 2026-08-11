/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { AlertCircle, LoaderCircle, X } from 'lucide-react';
import { useService, WorkflowSelectService } from '@flowgram.ai/free-layout-editor';

import { Button } from '@/components/ui';

import { useProblemPanel, useNodeFormPanel } from '../../plugins/panel-manager-plugin/hooks';
import { useWatchValidate } from './use-watch-validate';

export const ProblemPanel = () => {
  const { results, loading } = useWatchValidate();

  const selectService = useService(WorkflowSelectService);

  const { close: closePanel } = useProblemPanel();
  const { open: openNodeFormPanel } = useNodeFormPanel();

  return (
    <div
      className="h-full w-full rounded-lg border border-border bg-background"
      style={{ color: 'var(--app-color-text-1)' }}
    >
      <div className="flex h-12 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          Problem {loading && <LoaderCircle className="animate-spin" />}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close problems"
          onClick={() => closePanel()}
        >
          <X />
        </Button>
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        {results.map((i) => (
          <button
            key={i.node.id}
            className="flex items-center rounded-lg border border-border p-2 text-left hover:bg-accent"
            onClick={() => {
              selectService.selectNodeAndScrollToView(i.node);
              openNodeFormPanel({ nodeId: i.node.id });
            }}
          >
            <img className="size-6 rounded-md" src={i.node.getNodeRegistry().info.icon} alt="" />
            <div className="ml-2 min-w-0">
              <div className="truncate text-xs font-medium">{i.node.form?.values.title}</div>
              <div className="truncate text-xs text-destructive">
                {i.feedbacks.map((item) => item.feedbackText).join(', ')}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export const ProblemButton = () => {
  const { open } = useProblemPanel();
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Problem" onClick={() => open()}>
      <AlertCircle />
    </Button>
  );
};
