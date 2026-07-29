/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import {
  WorkflowNodeJSON as FlowNodeJSONDefault,
  WorkflowNodeRegistry as FlowNodeRegistryDefault,
  FreeLayoutPluginContext,
  FlowNodeEntity,
  type WorkflowEdgeJSON,
  WorkflowNodeMeta,
} from '@flowgram.ai/free-layout-editor';
import { IFlowValue } from '@flowgram.ai/form-materials';

import { type JsonSchema } from './json-schema';
import { WorkflowNodeType } from '../nodes';

/**
 * You can customize the data of the node, and here you can use JsonSchema to define the input and output of the node
 */
export interface FlowNodeJSON extends FlowNodeJSONDefault {
  data: {
    /**
     * Node title
     */
    title?: string;
    /**
     * Inputs data values
     */
    inputsValues?: Record<string, IFlowValue>;
    /**
     * Define the inputs data of the node by JsonSchema
     */
    inputs?: JsonSchema;
    /**
     * Define the outputs data of the node by JsonSchema
     */
    outputs?: JsonSchema;
    /**
     * Rest properties
     */
    [key: string]: any;
  };
}

/**
 * You can customize your own node meta
 */
export interface FlowNodeMeta extends WorkflowNodeMeta {
  sidebarDisabled?: boolean;
  nodePanelHidden?: boolean;
  wrapperStyle?: React.CSSProperties;
  onlyInContainer?: WorkflowNodeType;
}

/**
 * You can customize your own node registry
 */
export interface FlowNodeRegistry extends FlowNodeRegistryDefault {
  meta: FlowNodeMeta;
  info?: {
    icon: string;
    description: string;
  };
  canAdd?: (ctx: FreeLayoutPluginContext) => boolean;
  canDelete?: (ctx: FreeLayoutPluginContext, from: FlowNodeEntity) => boolean;
  onAdd?: (ctx: FreeLayoutPluginContext) => FlowNodeJSON;
}

export interface FlowDocumentJSON {
  nodes: FlowNodeJSON[];
  edges: WorkflowEdgeJSON[];
  /**
   * Global Variable Schema Definition
   *
   * Warning: In real occasion, it's better to store the schema and value of these global variables in a reliable place, since the value of a variable might be leaked in saved schema.
   */
  globalVariable?: JsonSchema;
}
