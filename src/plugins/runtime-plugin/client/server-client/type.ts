/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import type { TaskRunInput } from '@flowgram.ai/runtime-interface';

export interface ServerError {
  code: string;
  message: string;
}

/**
 * The POST /api/task/run request body. Extends the upstream TaskRunInput
 * ({inputs, schema}) with an optional `workflowId` — present for saved-workflow
 * runs (backend enqueues into the per-workflow serial queue, Phase 2 of #152),
 * absent for draft runs (backend takes the immediate-execution path).
 *
 * Defined here rather than by extending TaskRunInput because that type is owned
 * by @flowgram.ai/runtime-interface and cannot be modified.
 */
export type TaskRunRequestBody = TaskRunInput & {
  workflowId?: string;
};
