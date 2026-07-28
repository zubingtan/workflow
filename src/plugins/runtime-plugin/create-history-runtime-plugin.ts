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

export interface HistoryRuntimePluginOptions {
  report: IReport;
  runID?: string;
}

export const createHistoryRuntimePlugin = definePluginCreator<
  HistoryRuntimePluginOptions,
  PluginContext
>({
  onBind({ rebind }) {
    // Replace the live runtime service with the static history one. The same
    // DI token is used so `useService(WorkflowRuntimeService)` resolves to the
    // static instance in the history editor.
    rebind(WorkflowRuntimeService).to(StaticHistoryRuntimeService).inSingletonScope();
  },
  onInit(ctx, options) {
    const svc = ctx.get<StaticHistoryRuntimeService>(WorkflowRuntimeService);
    svc.setReport(options.report, options.runID);
  },
});
