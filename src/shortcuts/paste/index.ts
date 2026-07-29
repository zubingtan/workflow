/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import {
  delay,
  EntityManager,
  FlowNodeTransformData,
  FreeLayoutPluginContext,
  IPoint,
  PlaygroundConfigEntity,
  Rectangle,
  ShortcutsHandler,
  WorkflowDocument,
  WorkflowDragService,
  WorkflowHoverService,
  WorkflowJSON,
  WorkflowNodeEntity,
  WorkflowNodeMeta,
  WorkflowSelectService,
  Playground,
} from '@flowgram.ai/free-layout-editor';
import { Toast } from '@douyinfe/semi-ui';

import { WorkflowClipboardData, WorkflowClipboardRect } from '../type';
import { FlowCommandId, WorkflowClipboardDataID } from '../constants';
import { canContainNode } from '../../utils';
import { generateUniqueWorkflow } from './unique-workflow';

export class PasteShortcut implements ShortcutsHandler {
  public commandId = FlowCommandId.PASTE;

  public shortcuts = ['meta v', 'ctrl v'];

  private playgroundConfig: PlaygroundConfigEntity;

  private document: WorkflowDocument;

  private selectService: WorkflowSelectService;

  private entityManager: EntityManager;

  private hoverService: WorkflowHoverService;

  private dragService: WorkflowDragService;

  private playground: Playground;

  /**
   * initialize paste shortcut handler
   */
  constructor(context: FreeLayoutPluginContext) {
    this.playgroundConfig = context.playground.config;
    this.document = context.get(WorkflowDocument);
    this.selectService = context.get(WorkflowSelectService);
    this.entityManager = context.get(EntityManager);
    this.hoverService = context.get(WorkflowHoverService);
    this.dragService = context.get(WorkflowDragService);
    this.playground = context.playground;
    this.execute = this.execute.bind(this);
  }

  /**
   * execute paste action
   */
  public async execute(): Promise<WorkflowNodeEntity[] | undefined> {
    if (this.readonly) {
      return;
    }
    const data = await this.tryReadClipboard();
    if (!data) {
      return;
    }
    if (!this.isValidData(data)) {
      return;
    }
    const nodes = this.apply(data);
    if (nodes.length > 0) {
      Toast.success({
        content: 'Copy successfully',
        showClose: false,
      });
      // wait for nodes to render
      await this.nextTick();
      // scroll to visible area
      this.scrollNodesToView(nodes);
    }
    return nodes;
  }

  /** apply clipboard data */
  public apply(data: WorkflowClipboardData): WorkflowNodeEntity[] {
    // extract raw json from clipboard data
    const { json: rawJSON } = data;
    const json = generateUniqueWorkflow({
      json: rawJSON,
      isUniqueId: (id: string) => !this.entityManager.getEntityById(id),
    });

    const offset = this.calcPasteOffset(data.bounds);
    let parent = this.getSelectedContainer();
    // Loop nodes do not support nesting
    if (parent && json.nodes.some((n) => !canContainNode(n.type, parent!.flowNodeType))) {
      parent = undefined;
    }
    this.applyOffset({ json, offset, parent });
    const { nodes } = this.document.batchAddFromJSON(json, {
      parent,
    });
    this.selectNodes(nodes);
    // The canvas must be focused here so shortcuts keep working
    this.playground.node.focus();
    return nodes;
  }

  /**
   * readonly
   */
  private get readonly(): boolean {
    return this.playgroundConfig.readonly;
  }

  private isValidData(data?: WorkflowClipboardData): boolean {
    if (data?.type !== WorkflowClipboardDataID) {
      Toast.error({
        content: 'Invalid clipboard data',
      });
      return false;
    }
    // Cross-domain means different environments with different installed plugins, so paste is not allowed
    if (data.source.host !== window.location.host) {
      Toast.error({
        content: 'Cannot paste nodes from different host',
      });
      return false;
    }
    // Check container
    const parent = this.getSelectedContainer();
    for (const nodeJSON of data.json.nodes) {
      const res = this.dragService.canDropToNode({
        dragNodeType: nodeJSON.type,
        dropNodeType: parent?.flowNodeType,
        dropNode: parent,
      });
      if (!res.allowDrop) {
        Toast.error({
          content: res.message ?? 'Cannot paste nodes to invalid container',
        });
        return false;
      }
    }
    return true;
  }

  /** try to read clipboard */
  private async tryReadClipboard(): Promise<WorkflowClipboardData | undefined> {
    try {
      // Reading the clipboard requires user permission; if the user has not granted it,
      // this may throw a NotAllowedError.
      const text: string = (await navigator.clipboard.readText()) || '';
      const clipboardData: WorkflowClipboardData = JSON.parse(text);
      return clipboardData;
    } catch (e) {
      // Clipboard contents are arbitrary, so there is no need to surface an error here.
      return;
    }
  }

  /** calculate paste offset */
  private calcPasteOffset(boundsData: WorkflowClipboardRect): IPoint {
    // extract bounds data
    const { x, y, width, height } = boundsData;
    const rect = new Rectangle(x, y, width, height);
    const { center } = rect;
    const mousePos = this.hoverService.hoveredPos;
    return {
      x: mousePos.x - center.x,
      y: mousePos.y - center.y,
    };
  }

  /**
   * apply offset to node positions
   */
  private applyOffset(params: {
    json: WorkflowJSON;
    offset: IPoint;
    parent?: WorkflowNodeEntity;
  }): void {
    const { json, offset, parent } = params;
    json.nodes.forEach((nodeJSON) => {
      if (!nodeJSON.meta?.position) {
        return;
      }
      // calculate new position
      let position = {
        x: nodeJSON.meta.position.x + offset.x,
        y: nodeJSON.meta.position.y + offset.y,
      };
      if (parent) {
        position = this.dragService.adjustSubNodePosition(
          nodeJSON.type as string,
          parent,
          position
        );
      }
      nodeJSON.meta.position = position;
    });
  }

  /** get selected container node */
  private getSelectedContainer(): WorkflowNodeEntity | undefined {
    const { activatedNode } = this.selectService;
    return activatedNode?.getNodeMeta<WorkflowNodeMeta>().isContainer ? activatedNode : undefined;
  }

  /** select nodes */
  private selectNodes(nodes: WorkflowNodeEntity[]): void {
    this.selectService.selection = nodes;
  }

  /** scroll to nodes */
  private async scrollNodesToView(nodes: WorkflowNodeEntity[]): Promise<void> {
    const nodeBounds = nodes.map((node) => node.getData(FlowNodeTransformData).bounds);
    await this.document.playgroundConfig.scrollToView({
      bounds: Rectangle.enlarge(nodeBounds),
    });
  }

  /** wait for next frame */
  private async nextTick(): Promise<void> {
    // 16ms is one render frame
    const frameTime = 16;
    await delay(frameTime);
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}
