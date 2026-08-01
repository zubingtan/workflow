/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import {
  FreeLayoutPluginContext,
  ShortcutsHandler,
  WorkflowDocument,
  WorkflowLineEntity,
  WorkflowNodeEntity,
  WorkflowNodeMeta,
  WorkflowSelectService,
  HistoryService,
  PlaygroundConfigEntity,
} from '@flowgram.ai/free-layout-editor';
import { Toast } from '@douyinfe/semi-ui';

import { FlowCommandId } from '../constants';
import { canRemoveEndNodes } from '../../utils/end-node.mjs';
import { WorkflowNodeType } from '../../nodes';

export class DeleteShortcut implements ShortcutsHandler {
  public commandId = FlowCommandId.DELETE;

  public shortcuts = ['backspace', 'delete'];

  private playgroundConfig: PlaygroundConfigEntity;

  private document: WorkflowDocument;

  private selectService: WorkflowSelectService;

  private historyService: HistoryService;

  /**
   * initialize delete shortcut
   */
  constructor(context: FreeLayoutPluginContext) {
    this.playgroundConfig = context.playground.config;
    this.document = context.get(WorkflowDocument);
    this.selectService = context.get(WorkflowSelectService);
    this.historyService = context.get(HistoryService);
    this.execute = this.execute.bind(this);
  }

  /**
   * execute delete operation
   */
  public async execute(nodes?: WorkflowNodeEntity[]): Promise<void> {
    if (this.readonly) {
      return;
    }
    const selection = Array.isArray(nodes) ? nodes : this.selectService.selection;
    if (
      !this.isValid(
        selection.filter((n) => n instanceof WorkflowNodeEntity) as WorkflowNodeEntity[]
      )
    ) {
      return;
    }
    // Merge actions to redo/undo
    this.historyService.startTransaction();
    // delete selected entities
    selection.forEach((entity) => {
      if (entity instanceof WorkflowNodeEntity) {
        this.removeNode(entity);
      } else if (entity instanceof WorkflowLineEntity) {
        this.removeLine(entity);
      } else {
        entity.dispose();
      }
    });
    // filter out disposed entities
    this.selectService.selection = this.selectService.selection.filter((s) => !s.disposed);
    this.historyService.endTransaction();
  }

  /**
   * readonly
   */
  private get readonly(): boolean {
    return this.playgroundConfig.readonly;
  }

  /**
   * validate if nodes can be deleted
   *
   * - The Start node can never be deleted.
   * - End nodes can be deleted, but at least one End must always remain
   *   (a workflow may have several Ends, one per condition branch).
   */
  private isValid(nodes: WorkflowNodeEntity[]): boolean {
    const hasStart = nodes.some(
      (n) => (n.flowNodeType as WorkflowNodeType) === WorkflowNodeType.Start
    );
    if (hasStart) {
      Toast.error({
        content: 'Start node cannot be deleted',
        showClose: false,
      });
      return false;
    }
    const selectedEndCount = nodes.filter(
      (n) => (n.flowNodeType as WorkflowNodeType) === WorkflowNodeType.End
    ).length;
    if (selectedEndCount > 0) {
      const totalEndCount = this.document
        .getAllNodes()
        .filter((n) => (n.flowNodeType as WorkflowNodeType) === WorkflowNodeType.End).length;
      if (!canRemoveEndNodes(totalEndCount, selectedEndCount)) {
        Toast.error({
          content: 'At least one End node must remain',
          showClose: false,
        });
        return false;
      }
    }
    return true;
  }

  /**
   * remove node from workflow
   */
  private removeNode(node: WorkflowNodeEntity): void {
    if (!this.document.canRemove(node)) {
      return;
    }
    const nodeMeta = node.getNodeMeta<WorkflowNodeMeta>();
    const subCanvas = nodeMeta.subCanvas?.(node);
    if (subCanvas?.isCanvas) {
      subCanvas.parentNode.dispose();
      return;
    }
    node.dispose();
  }

  /**
   * remove line from workflow
   */
  private removeLine(line: WorkflowLineEntity): void {
    if (!this.document.linesManager.canRemove(line)) {
      return;
    }
    line.dispose();
  }
}
