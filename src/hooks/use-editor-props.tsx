/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { useMemo, useRef, type RefObject } from 'react';

import { debounce } from 'lodash-es';
import { IReport } from '@flowgram.ai/runtime-interface';
import { createMinimapPlugin } from '@flowgram.ai/minimap-plugin';
import { createFreeStackPlugin } from '@flowgram.ai/free-stack-plugin';
import { createFreeSnapPlugin } from '@flowgram.ai/free-snap-plugin';
import { createFreeNodePanelPlugin } from '@flowgram.ai/free-node-panel-plugin';
import { createFreeLinesPlugin } from '@flowgram.ai/free-lines-plugin';
import {
  FlowNodeBaseType,
  FreeLayoutPluginContext,
  FreeLayoutProps,
  WorkflowContentChangeType,
  WorkflowDocument,
  WorkflowNodeEntity,
} from '@flowgram.ai/free-layout-editor';
import { createFreeGroupPlugin } from '@flowgram.ai/free-group-plugin';
import { createContainerNodePlugin } from '@flowgram.ai/free-container-plugin';
import { createDownloadPlugin } from '@flowgram.ai/export-plugin';

import { rotateAllPorts, rotateNodePorts, type LayoutDirection } from '../utils/rotate-ports';
import { canContainNode, onDragLineEnd } from '../utils';
import { FlowNodeRegistry, FlowDocumentJSON } from '../typings';
import { shortcuts } from '../shortcuts';
import { CustomService, ValidateService } from '../services';
import { GetGlobalVariableSchema } from '../plugins/variable-panel-plugin';
import { StaticHistoryRuntimeService } from '../plugins/runtime-plugin/runtime-service/static-history';
import { LiveHistoryRuntimeService } from '../plugins/runtime-plugin/runtime-service/live-history';
import { WorkflowRuntimeService } from '../plugins/runtime-plugin/runtime-service';
import {
  createRuntimePlugin,
  createHistoryRuntimePlugin,
  createLiveHistoryRuntimePlugin,
  createContextMenuPlugin,
  createVariablePanelPlugin,
  createPanelManagerPlugin,
} from '../plugins';
import { defaultFormMeta } from '../nodes/default-form-meta';
import { WorkflowNodeType } from '../nodes';
import { getMinimapCanvasStyle } from '../components/tools/minimap-canvas-style.mjs';
import { SelectorBoxPopover } from '../components/selector-box-popover';
import { BaseNode, CommentRender, GroupNodeRender, LineAddButton, NodePanel } from '../components';

export interface UseEditorPropsOptions {
  /** Historical terminal report — when present, the editor renders in
   * readonly history mode (Phase 8 #160) using StaticHistoryRuntimeService. */
  historyReport?: IReport;
  /** The runID the historyReport belongs to (for display only). */
  historyRunID?: string;
  /** #181: live-running run ID. When present (and no historyReport), the
   * editor renders readonly with LiveHistoryRuntimeService subscribed to SSE. */
  liveRunID?: string;
  liveWorkflowId?: string;
  /** #182: callback invoked when the live SSE stream delivers run_terminal.
   * The ReadonlyViewer uses this to refetch + remount in static mode without
   * opening a second SSE connection (HTTP/1.1 connection exhaustion fix). */
  onLiveTerminal?: () => void;
}

export function useEditorProps(
  initialData: FlowDocumentJSON,
  nodeRegistries: FlowNodeRegistry[],
  ctxRef?: { current: FreeLayoutPluginContext | null },
  onDirty?: () => void,
  workflowId?: string,
  history?: UseEditorPropsOptions,
  /**
   * #190: stable ref to the current LayoutDirection (kept in sync by
   * LayoutDirectionProvider). Read by the ADD_NODE listener registered in
   * onInit so newly-added nodes inherit the current direction's port
   * anchors. Optional — absent in history/live view (no port rotation).
   */
  directionRef?: RefObject<LayoutDirection>
): FreeLayoutProps {
  // #182: keep the latest onLiveTerminal in a ref so the empty-deps useMemo
  // (which captures the plugin config at mount time) always invokes the
  // current callback. Without this, a re-render with a new callback closure
  // (e.g. after detail state changes) would be ignored.
  const onLiveTerminalRef = useRef(history?.onLiveTerminal);
  onLiveTerminalRef.current = history?.onLiveTerminal;

  return useMemo<FreeLayoutProps>(
    () => ({
      /**
       * Whether to enable the background
       */
      background: true,
      /**
       * Canvas-related configurations
       */
      playground: {
        /**
         * Prevent Mac browser gestures from turning pages
         */
        preventGlobalGesture: true,
      },
      /**
       * Whether it is read-only or not, the node cannot be dragged in read-only mode.
       * Phase 8 (#160): history view forces readonly so all edit affordances
       * (drag, add-node, delete, form inputs) are auto-disabled by the
       * existing gates documented in research/readonly-editor-history.md §1c.
       * #181: live-running view also forces readonly.
       */
      readonly: !!(history?.historyReport || history?.liveRunID),
      /**
       * Line support both-way connection (default true)
       */
      twoWayConnection: true,
      /**
       * Enable dragging of read-only nodes (default false)
       */
      enableReadonlyNodeDragging: false,
      /**
       * Initial data
       */
      initialData,
      /**
       * Node registries
       */
      nodeRegistries,
      /**
       * Get the default node registry, which will be merged with the 'nodeRegistries'
       */
      getNodeDefaultRegistry(type) {
        return {
          type,
          meta: {
            defaultExpanded: true,
          },
          formMeta: defaultFormMeta,
        };
      },
      /**
       * Node data transformation, called by ctx.document.fromJSON
       * @param node
       * @param json
       */
      fromNodeJSON(node, json) {
        return json;
      },
      /**
       * Node data transformation, called by ctx.document.toJSON
       * @param node
       * @param json
       */
      toNodeJSON(node, json) {
        return json;
      },
      lineColor: {
        hidden: 'var(--g-workflow-line-color-hidden,transparent)',
        default: 'var(--g-workflow-line-color-default,#4d53e8)',
        drawing: 'var(--g-workflow-line-color-drawing, #5DD6E3)',
        hovered: 'var(--g-workflow-line-color-hover,#37d0ff)',
        selected: 'var(--g-workflow-line-color-selected,#37d0ff)',
        error: 'var(--g-workflow-line-color-error,red)',
        flowing: 'var(--g-workflow-line-color-flowing,#4d53e8)',
      },
      /*
       * Check whether the line can be added
       */
      canAddLine(ctx, fromPort, toPort) {
        // Cannot be a self-loop on the same node
        if (fromPort.node === toPort.node) {
          return false;
        }
        // Cannot be in different containers
        if (
          fromPort.node.parent?.id !== toPort.node.parent?.id &&
          ![fromPort.node.parent?.flowNodeType, toPort.node.parent?.flowNodeType].includes(
            FlowNodeBaseType.GROUP
          )
        ) {
          return false;
        }
        /**
         * Line loop detection, which is not allowed to connect to the node in front of it
         */
        return !fromPort.node.lines.allInputNodes.includes(toPort.node);
      },
      /**
       * Check whether the line can be deleted, this triggers on the default shortcut `Bakspace` or `Delete`
       */
      canDeleteLine(ctx, line, newLineInfo, silent) {
        return true;
      },
      /**
       * Check whether the node can be deleted, this triggers on the default shortcut `Bakspace` or `Delete`
       */
      canDeleteNode(ctx, node) {
        return true;
      },
      /**
       * Whether to allow dragging into the sub-canvas (loop or group)
       */
      canDropToNode: (ctx, params) => canContainNode(params.dragNodeType!, params.dropNodeType!),
      /**
       * Whether to reset line
       * @param ctx
       * @param oldLine
       * @param newLineInfo
       */
      canResetLine: (ctx, oldLine, newLineInfo) => true,
      /**
       * Drag the end of the line to create an add panel (feature optional)
       */
      onDragLineEnd,
      /**
       * SelectBox config
       */
      selectBox: {
        SelectorBoxPopover,
      },
      scroll: {
        /**
         * Whether to restrict the node from rolling out of the canvas needs to be closed because there is a running results pane
         */
        enableScrollLimit: false,
      },
      materials: {
        components: {},
        /**
         * Render Node
         */
        renderDefaultNode: BaseNode,
        renderNodes: {
          [WorkflowNodeType.Comment]: CommentRender,
        },
      },
      /**
       * Node engine enable, you can configure formMeta in the FlowNodeRegistry
       */
      nodeEngine: {
        enable: true,
      },
      /**
       * Variable engine enable
       */
      variableEngine: {
        enable: true,
      },
      /**
       * Redo/Undo enable
       */
      history: {
        enable: true,
        /**
         * Listen form data change, default true
         */
        enableChangeNode: true,
      },
      /**
       * Content change
       */
      onContentChange: debounce((ctx: FreeLayoutPluginContext, event) => {
        if (ctx.document.disposed) return;

        onDirty?.();
        console.log('Content changed: ', event, {
          ...ctx.document.toJSON(),
          globalVariable: ctx.get<GetGlobalVariableSchema>(GetGlobalVariableSchema)(),
        });
      }, 1000),
      /**
       * Running line
       */
      isFlowingLine: (ctx, line) => ctx.get(WorkflowRuntimeService).isFlowingLine(line),
      /**
       * Shortcuts
       */
      shortcuts,
      /**
       * Bind custom service
       */
      onBind: ({ bind }) => {
        bind(CustomService).toSelf().inSingletonScope();
        bind(ValidateService).toSelf().inSingletonScope();
      },
      /**
       * Playground init
       */
      onInit(ctx) {
        if (ctxRef) {
          ctxRef.current = ctx;
        }
        // #190: Register a single ADD_NODE listener that rotates newly-added
        // nodes' port anchors to match the current layout direction. This
        // covers all 6 node-creation paths (add-node button, port-click,
        // line-add-button, drag-line-end, context-menu, comment button) from
        // one injection point. `directionRef` is a stable ref mirror of the
        // LayoutDirectionContext value, so this closure (captured once at
        // init) always reads the latest direction without re-registering.
        // Skipped in history/live view (no directionRef passed → readonly,
        // no port rotation needed on a frozen snapshot).
        if (directionRef) {
          const doc = ctx.document as WorkflowDocument;
          doc.onContentChange((event) => {
            if (event.type !== WorkflowContentChangeType.ADD_NODE) return;
            const direction = directionRef.current;
            if (!direction || direction === 'LR') return; // default, no rotation
            const node = event.entity as WorkflowNodeEntity;
            rotateNodePorts(node, direction);
          });
          // #190: fromJSON sets `changeEntityLocked = true` which suppresses
          // fireContentChange, so the ADD_NODE listener above does NOT fire
          // during load. `onLoaded` fires after fromJSON completes — rotate
          // all ports once here if the persisted direction is TB.
          doc.onLoaded(() => {
            const direction = directionRef.current;
            if (direction === 'TB') {
              rotateAllPorts(doc, 'TB');
              doc.fireRender();
            }
          });
        }
        console.log('--- Playground init ---');
      },
      /**
       * Playground render
       */
      onAllLayersRendered(ctx) {
        // ctx.tools.autoLayout(); // init auto layout
        ctx.tools.fitView(false);
        // Phase 8 (#160): flush the static history report into node renderers
        // now that they've mounted and subscribed to onNodeReportChange.
        if (history?.historyReport) {
          const svc = ctx.get<StaticHistoryRuntimeService>(WorkflowRuntimeService);
          if (svc instanceof StaticHistoryRuntimeService) {
            svc.flush();
          }
        }
        if (history?.liveRunID) {
          const svc = ctx.get<LiveHistoryRuntimeService>(WorkflowRuntimeService);
          if (svc instanceof LiveHistoryRuntimeService) {
            svc.flush();
          }
        }
        console.log('--- Playground rendered ---');
      },
      /**
       * Playground dispose
       */
      onDispose() {
        console.log('---- Playground Dispose ----');
      },
      i18n: {
        locale: navigator.language,
        languages: {
          'en-US': {},
        },
      },
      plugins: () => [
        /**
         * Custom node sorting, the code below will make the comment nodes always below the normal nodes
         */
        createFreeStackPlugin({
          sortNodes: (nodes: WorkflowNodeEntity[]) => {
            const commentNodes: WorkflowNodeEntity[] = [];
            const otherNodes: WorkflowNodeEntity[] = [];
            nodes.forEach((node) => {
              if (node.flowNodeType === WorkflowNodeType.Comment) {
                commentNodes.push(node);
              } else {
                otherNodes.push(node);
              }
            });
            return [...commentNodes, ...otherNodes];
          },
        }),
        /**
         * Line render plugin
         */
        createFreeLinesPlugin({
          renderInsideLine: LineAddButton,
        }),
        /**
         * Minimap plugin
         */
        createMinimapPlugin({
          disableLayer: true,
          // First-mount canvasStyle. Runtime theme switches are handled by
          // `<Minimap>` calling `FlowMinimapService.init({ canvasStyle })`,
          // so this value only matters until the Minimap component's first
          // effect runs (which immediately re-inits with the current theme).
          canvasStyle: getMinimapCanvasStyle('light'),
        }),
        /**
         * Download plugin
         */
        createDownloadPlugin({}),
        /**
         * Snap plugin
         */
        createFreeSnapPlugin({
          edgeColor: '#00B2B2',
          alignColor: '#00B2B2',
          edgeLineWidth: 1,
          alignLineWidth: 1,
          alignCrossWidth: 8,
        }),
        /**
         * NodeAddPanel render plugin
         */
        createFreeNodePanelPlugin({
          renderer: NodePanel,
        }),
        /**
         * This is used for the rendering of the loop node sub-canvas
         */
        createContainerNodePlugin({}),
        /**
         * Group plugin
         */
        createFreeGroupPlugin({
          groupNodeRender: GroupNodeRender,
        }),
        /**
         * ContextMenu plugin
         */
        createContextMenuPlugin({}),
        /**
         * Runtime plugin
         * Server mode: workflow execution runs on the Hono backend via FlowGram protocol
         *
         * Phase 8 (#160): in history view, swap to the read-only
         * StaticHistoryRuntimeService (no polling, no taskRun) so the canvas
         * renders the historical terminal snapshot.
         *
         * #181: in live-running view, swap to LiveHistoryRuntimeService which
         * subscribes to the SSE event stream and fires per-node progress.
         */
        history?.liveRunID && history?.liveWorkflowId
          ? createLiveHistoryRuntimePlugin({
              runID: history.liveRunID,
              workflowId: history.liveWorkflowId,
              // #182: pass a wrapper that reads from the ref so the plugin
              // always calls the latest onLiveTerminal (the ref is updated on
              // every render, but the plugin config is captured once at mount).
              onTerminal: () => onLiveTerminalRef.current?.(),
            })
          : history?.historyReport
          ? createHistoryRuntimePlugin({
              report: history.historyReport,
              runID: history.historyRunID,
            })
          : createRuntimePlugin({
              mode: 'server',
              serverConfig: {
                // Same-origin: derive from window.location so the runtime client
                // (TaskRun/TaskReport) hits the same host that served the SPA.
                // Fixes remote access via tunnels (e.g. ssh -R 14001:localhost:4001)
                // where the browser origin differs from the backend's :4001.
                domain: window.location.hostname,
                port: window.location.port ? Number(window.location.port) : undefined,
                protocol: window.location.protocol.replace(':', ''),
                // #297: sub-path mount (e.g. /workflow behind nginx) — prefix
                // every runtime API call with the same base the SPA was served
                // from (injected at build time; empty for root-path builds).
                basePath: process.env.BASE_PATH ?? '',
                // Thread the saved workflow's id into POST /api/task/run so the
                // backend enqueues into the per-workflow serial queue (Phase 2 of
                // #152). Undefined for draft runs → backend takes immediate path.
                workflowId,
              },
            }),

        /**
         * Variable panel plugin
         */
        createVariablePanelPlugin({
          initialData: initialData.globalVariable,
        }),
        /** Float layout plugin */
        createPanelManagerPlugin(),
      ],
    }),
    // Empty deps is safe: `initialData`/`ctxRef`/`workflowId` are stable per
    // Editor mount — the Editor component is fully unmounted/remounted when
    // switching workflows, so this memo re-runs with fresh values each time.
    []
  );
}
