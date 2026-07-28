/**
 * Phase 8 (#160): plugin creator that swaps `WorkflowRuntimeService` for the
 * read-only `StaticHistoryRuntimeService` in the editor's DI container.
 *
 * Used by `HistoryViewer` (via `useEditorProps` when a `historyReport` is
 * provided) so the canvas renders the historical terminal snapshot without
 * any live execution capability.
 *
 * The `report` is set on the service instance in `onInit`; `flush()` is
 * called later from `useEditorProps`'s `onAllLayersRendered` so node
 * renderers have subscribed before the reports fire.
 */
import { IReport } from '@flowgram.ai/runtime-interface';
import { definePluginCreator, PluginContext } from '@flowgram.ai/free-layout-editor';

import { StaticHistoryRuntimeService } from './runtime-service/static-history';
import { WorkflowRuntimeService } from './runtime-service';
import {
  WorkflowRuntimeBrowserClient,
  WorkflowRuntimeClient,
  WorkflowRuntimeServerClient,
} from './client';

export interface HistoryRuntimePluginOptions {
  report: IReport;
  runID?: string;
}

export const createHistoryRuntimePlugin = definePluginCreator<
  HistoryRuntimePluginOptions,
  PluginContext
>({
  onBind({ bind, rebind }) {
    // Replace the live runtime service with the static history one. The same
    // DI token is used so `useService(WorkflowRuntimeService)` resolves to the
    // static instance in the history editor.
    //
    // In history mode, `createRuntimePlugin` is NOT loaded (useEditorProps
    // uses a ternary: history ? createHistoryRuntimePlugin : createRuntimePlugin),
    // so neither `WorkflowRuntimeService` nor its `WorkflowRuntimeClient`
    // dependencies are pre-bound. `rebind` internally calls `unbind`, which
    // throws "Could not unbind serviceIdentifier" if the service was never
    // bound — fall back to `bind` in that case. The client bindings are
    // required because `WorkflowRuntimeService` (the base class of
    // `StaticHistoryRuntimeService`) `@inject(WorkflowRuntimeClient)` — even
    // though the history service never uses it, Inversify resolves all
    // injected deps at construction time.
    bind(WorkflowRuntimeBrowserClient).toSelf().inSingletonScope();
    bind(WorkflowRuntimeServerClient).toSelf().inSingletonScope();
    try {
      rebind(WorkflowRuntimeClient).to(WorkflowRuntimeBrowserClient);
    } catch {
      bind(WorkflowRuntimeClient).to(WorkflowRuntimeBrowserClient);
    }
    try {
      rebind(WorkflowRuntimeService).to(StaticHistoryRuntimeService).inSingletonScope();
    } catch {
      bind(WorkflowRuntimeService).to(StaticHistoryRuntimeService).inSingletonScope();
    }
  },
  onInit(ctx, options) {
    const svc = ctx.get<StaticHistoryRuntimeService>(WorkflowRuntimeService);
    svc.setReport(options.report, options.runID);
  },
});
