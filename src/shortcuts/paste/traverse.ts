/**
 * Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 */

// traverse value type
export type TraverseValue = any;

// traverse node interface
export interface TraverseNode {
  value: TraverseValue; // node value
  container?: TraverseValue; // parent container
  parent?: TraverseNode; // parent node
  key?: string; // object key
  index?: number; // array index
}

// traverse context interface
export interface TraverseContext {
  node: TraverseNode; // current node
  setValue: (value: TraverseValue) => void; // set value function
  getParents: () => TraverseNode[]; // get parents function
  getPath: () => Array<string | number>; // get path function
  getStringifyPath: () => string; // get string path function
  deleteSelf: () => void; // delete self function
}

// traverse handler type
export type TraverseHandler = (context: TraverseContext) => void;

/**
 * traverse object deeply and handle each value
 * @param value traverse target
 * @param handle handler function
 */
export const traverse = <T extends TraverseValue = TraverseValue>(
  value: T,
  handler: TraverseHandler | TraverseHandler[]
): T => {
  const traverseHandler: TraverseHandler = Array.isArray(handler)
    ? (context: TraverseContext) => {
        handler.forEach((handlerFn) => handlerFn(context));
      }
    : handler;
  TraverseUtils.traverseNodes({ value }, traverseHandler);
  return value;
};

namespace TraverseUtils {
  /**
   * traverse nodes deeply and handle each value
   * @param node traverse node
   * @param handle handler function
   */
  export const traverseNodes = (node: TraverseNode, handle: TraverseHandler): void => {
    const { value } = node;
    if (!value) {
      // handle null value
      return;
    }
    if (Object.prototype.toString.call(value) === '[object Object]') {
      // traverse object properties
      Object.entries(value).forEach(([key, item]) =>
        traverseNodes(
          {
            value: item,
            container: value,
            key,
            parent: node,
          },
          handle
        )
      );
    } else if (Array.isArray(value)) {
      // traverse array elements from end to start
      for (let index = value.length - 1; index >= 0; index--) {
        const item: string = value[index];
        traverseNodes(
          {
            value: item,
            container: value,
            index,
            parent: node,
          },
          handle
        );
      }
    }
    const context: TraverseContext = createContext({ node });
    handle(context);
  };

  /**
   * create traverse context
   * @param node traverse node
   */
  const createContext = ({ node }: { node: TraverseNode }): TraverseContext => ({
    node,
    setValue: (value: unknown) => setValue(node, value),
    getParents: () => getParents(node),
    getPath: () => getPath(node),
    getStringifyPath: () => getStringifyPath(node),
    deleteSelf: () => deleteSelf(node),
  });

  /**
   * set node value
   * @param node traverse node
   * @param value new value
   */
  const setValue = (node: TraverseNode, value: unknown) => {
    // handle empty value
    if (!value || !node) {
      return;
    }
    node.value = value;
    // get container info from parent scope
    const { container, key, index } = node;
    if (key && container) {
      container[key] = value;
    } else if (typeof index === 'number') {
      container[index] = value;
    }
  };

  /**
   * get parent nodes
   * @param node traverse node
   */
  const getParents = (node: TraverseNode): TraverseNode[] => {
    const parents: TraverseNode[] = [];
    let currentNode: TraverseNode | undefined = node;
    while (currentNode) {
      parents.unshift(currentNode);
      currentNode = currentNode.parent;
    }
    return parents;
  };

  /**
   * get node path
   * @param node traverse node
   */
  const getPath = (node: TraverseNode): Array<string | number> => {
    const path: Array<string | number> = [];
    const parents = getParents(node);
    parents.forEach((parent) => {
      if (parent.key) {
        path.unshift(parent.key);
      } else if (parent.index) {
        path.unshift(parent.index);
      }
    });
    return path;
  };

  /**
   * get stringify path
   * @param node traverse node
   */
  const getStringifyPath = (node: TraverseNode): string => {
    const path = getPath(node);
    return path.reduce((stringifyPath: string, pathItem: string | number) => {
      if (typeof pathItem === 'string') {
        const re = /\W/g;
        if (re.test(pathItem)) {
          // handle special characters
          return `${stringifyPath}["${pathItem}"]`;
        }
        return `${stringifyPath}.${pathItem}`;
      } else {
        return `${stringifyPath}[${pathItem}]`;
      }
    }, '');
  };

  /**
   * delete current node
   * @param node traverse node
   */
  const deleteSelf = (node: TraverseNode): void => {
    const { container, key, index } = node;
    if (key && container) {
      delete container[key];
    } else if (typeof index === 'number') {
      container.splice(index, 1);
    }
  };
}
