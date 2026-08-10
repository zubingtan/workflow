/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

export interface RuntimeBrowserOptions {
  mode?: 'browser';
}

export interface RuntimeServerOptions {
  mode: 'server';
  serverConfig: ServerConfig;
}

export type RuntimePluginOptions = RuntimeBrowserOptions | RuntimeServerOptions;

export interface ServerConfig {
  domain: string;
  port?: number;
  protocol?: string;
  /**
   * URL path prefix the SPA is served under ('' for root mounts, e.g.
   * '/workflow' behind nginx). #297: prefixed onto every runtime API URL so
   * the client stays same-origin under sub-path mounts.
   */
  basePath?: string;
  /**
   * The saved workflow's id, threaded into POST /api/task/run so the backend
   * can enqueue the run into the per-workflow serial queue (Phase 2 of #152)
   * and persist it to workflow_runs. Undefined for draft runs (unsaved
   * canvas) — the backend then takes the immediate-execution path.
   */
  workflowId?: string;
}
