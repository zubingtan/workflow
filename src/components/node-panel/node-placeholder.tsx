/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

export const NodePlaceholder = () => (
  <div
    className="w-[360px] rounded-xl border border-border bg-card p-3 shadow-lg"
    data-testid="workflow.detail.node-panel.placeholder"
  >
    <div className="flex animate-pulse items-center gap-2">
      <div className="size-6 rounded-md bg-muted" />
      <div className="h-3 w-32 rounded bg-muted" />
    </div>
    <div className="mt-3 h-3 w-48 animate-pulse rounded bg-muted" />
  </div>
);
