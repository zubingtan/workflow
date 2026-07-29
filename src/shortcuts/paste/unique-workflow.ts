/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

import { customAlphabet } from 'nanoid';
import type { WorkflowJSON, WorkflowNodeJSON } from '@flowgram.ai/free-layout-editor';

import { traverse, TraverseContext } from './traverse';

namespace UniqueWorkflowUtils {
  /** generate unique id */
  const generateUniqueId = customAlphabet('1234567890', 6); // create a function to generate a 6-digit number

  /** get all node ids from workflow json */
  export const getAllNodeIds = (json: WorkflowJSON): string[] => {
    const nodeIds = new Set<string>(); // use a Set to store unique ids
    const addNodeId = (node: WorkflowNodeJSON) => {
      nodeIds.add(node.id);
      if (node.blocks?.length) {
        node.blocks.forEach((child) => addNodeId(child)); // recursively add child node ids
      }
    };
    json.nodes.forEach((node) => addNodeId(node));
    return Array.from(nodeIds);
  };

  /** generate node replacement mapping */
  export const generateNodeReplaceMap = (
    nodeIds: string[],
    isUniqueId: (id: string) => boolean
  ): Map<string, string> => {
    const nodeReplaceMap = new Map<string, string>(); // create a map for id replacement
    nodeIds.forEach((id) => {
      if (isUniqueId(id)) {
        nodeReplaceMap.set(id, id); // keep original id if unique
      } else {
        let newId: string;
        do {
          newId = generateUniqueId(); // generate a new id until unique
        } while (!isUniqueId(newId));
        nodeReplaceMap.set(id, newId);
      }
    });
    return nodeReplaceMap;
  };

  /** check if value exists */
  const isExist = (value: unknown): boolean => value !== null && value !== undefined;

  /** check if node should be handled */
  const shouldHandle = (context: TraverseContext): boolean => {
    const { node } = context;
    // check edge data
    if (
      node?.key &&
      ['sourceNodeID', 'targetNodeID'].includes(node.key) &&
      node.parent?.parent?.key === 'edges'
    ) {
      return true;
    }
    // check node data
    if (
      node?.key === 'id' &&
      isExist(node.container?.type) &&
      isExist(node.container?.meta) &&
      isExist(node.container?.data)
    ) {
      return true;
    }
    // check variable data
    if (
      node?.key === 'blockID' &&
      isExist(node.container?.name) &&
      node.container?.source === 'block-output'
    ) {
      return true;
    }
    return false;
  };

  /**
   * replace node ids in workflow json
   * notice: this method has side effects, it will modify the input json to avoid deep copy overhead
   */
  export const replaceNodeId = (
    json: WorkflowJSON,
    nodeReplaceMap: Map<string, string>
  ): WorkflowJSON => {
    traverse(json, (context) => {
      if (!shouldHandle(context)) {
        return;
      }
      const { node } = context;
      if (nodeReplaceMap.has(node.value)) {
        context.setValue(nodeReplaceMap.get(node.value)); // replace old id with new id
      }
    });
    return json;
  };
}

/** generate unique workflow json */
export const generateUniqueWorkflow = (params: {
  json: WorkflowJSON;
  isUniqueId: (id: string) => boolean;
}): WorkflowJSON => {
  const { json, isUniqueId } = params;
  const nodeIds = UniqueWorkflowUtils.getAllNodeIds(json); // get all existing node ids
  const nodeReplaceMap = UniqueWorkflowUtils.generateNodeReplaceMap(nodeIds, isUniqueId); // generate id replacement map
  return UniqueWorkflowUtils.replaceNodeId(json, nodeReplaceMap); // replace all node ids
};
