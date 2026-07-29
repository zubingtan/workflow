/**
 * #181: plugin creator that swaps `WorkflowRuntimeService` for the
 * read-only `LiveHistoryRuntimeService` in the editor's DI container.
 *
 * Used by `ReadonlyViewer` (via `useEditorProps` when `liveRunID` is provided)
 * so the canvas renders a live-running workflow's per-node progress by
 * subscribing to the SSE event stream — no polling, no taskRun.
 *
 * The SSE subscription is opened in `onInit` (after the editor mounts) and
 * closed when the ReadonlyViewer unmounts or switches to static mode.
 */
import { definePluginCreator, PluginContext } from '@flowgram.ai/free-layout-editor';

import { LiveHistoryRuntimeService } from './runtime-service/live-history';
import { WorkflowRuntimeService } from './runtime-service';
import {
  WorkflowRuntimeBrowserClient,
  WorkflowRuntimeClient,
  WorkflowRuntimeServerClient,
} from './client';

export interface LiveHistoryRuntimePluginOptions {
  runID: string;
  workflowId: string;
  // #182: callback invoked when the SSE stream delivers run_terminal for our
  // runID. The ReadonlyViewer uses this to refetch + remount in static mode
  // without opening a second SSE connection (avoids HTTP/1.1 connection
  // exhaustion when the manager page already has N SSE subscriptions open).
  onTerminal?: () => void;
}

export const createLiveHistoryRuntimePlugin = definePluginCreator<
  LiveHistoryRuntimePluginOptions,
  PluginContext
>({
  onBind({ bind, rebind }) {
    // Same DI pattern as createHistoryRuntimePlugin — the live service
    // subclasses WorkflowRuntimeService, which @injects WorkflowRuntimeClient
    // at construction time even though the live service never uses it.
    bind(WorkflowRuntimeBrowserClient).toSelf().inSingletonScope();
    bind(WorkflowRuntimeServerClient).toSelf().inSingletonScope();
    try {
      rebind(WorkflowRuntimeClient).to(WorkflowRuntimeBrowserClient);
    } catch {
      bind(WorkflowRuntimeClient).to(WorkflowRuntimeBrowserClient);
    }
    try {
      rebind(WorkflowRuntimeService).to(LiveHistoryRuntimeService).inSingletonScope();
    } catch {
      bind(WorkflowRuntimeService).to(LiveHistoryRuntimeService).inSingletonScope();
    }
  },
  onInit(ctx, options) {
    const svc = ctx.get<LiveHistoryRuntimeService>(WorkflowRuntimeService);
    if (typeof options.onTerminal === 'function') {
      svc.setOnTerminal(options.onTerminal);
    }
    svc.subscribe(options.runID, options.workflowId);
  },
  onDispose() {
    // The service's EventSource is closed by the ReadonlyViewer when it
    // unmounts or switches to static mode. Nothing to do here — the editor
    // disposes the DI container which drops the singleton service instance.
  },
});
