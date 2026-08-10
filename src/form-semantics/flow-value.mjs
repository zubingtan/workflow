/**
 * Application-owned Workflow value semantics.
 *
 * The shapes in this module are persisted in Workflow JSON. Keep this module
 * free of React and renderer imports so the editor can replace its controls
 * without changing the document protocol.
 */

import { isArray, isObject, isPlainObject, uniq } from 'lodash-es';
import { JsonSchemaUtils } from '@flowgram.ai/json-schema';

function hasType(value, type) {
  return (
    isPlainObject(value) &&
    value.type === type &&
    (value.extra === undefined ||
      (isPlainObject(value.extra) &&
        (value.extra.index === undefined || typeof value.extra.index === 'number')))
  );
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function clone(value) {
  return structuredClone(value);
}

export const FlowValueUtils = {
  isConstant(value) {
    return hasType(value, 'constant');
  },

  isRef(value) {
    return hasType(value, 'ref') && (value.content === undefined || isStringArray(value.content));
  },

  isExpression(value) {
    return (
      hasType(value, 'expression') &&
      (value.content === undefined || typeof value.content === 'string')
    );
  },

  isTemplate(value) {
    return (
      hasType(value, 'template') &&
      (value.content === undefined || typeof value.content === 'string')
    );
  },

  isConstantOrRef(value) {
    return FlowValueUtils.isConstant(value) || FlowValueUtils.isRef(value);
  },

  isFlowValue(value) {
    return (
      FlowValueUtils.isConstant(value) ||
      FlowValueUtils.isRef(value) ||
      FlowValueUtils.isExpression(value) ||
      FlowValueUtils.isTemplate(value)
    );
  },

  *traverse(value, options = {}) {
    const {
      includeTypes = ['ref', 'template', 'expression', 'constant'],
      path = '',
      pathArr = [],
    } = options;

    if (isPlainObject(value)) {
      if (FlowValueUtils.isRef(value) && includeTypes.includes('ref')) {
        yield { value, path, pathArr };
        return;
      }

      if (FlowValueUtils.isTemplate(value) && includeTypes.includes('template')) {
        yield { value, path, pathArr };
        return;
      }

      if (FlowValueUtils.isExpression(value) && includeTypes.includes('expression')) {
        yield { value, path, pathArr };
        return;
      }

      if (FlowValueUtils.isConstant(value) && includeTypes.includes('constant')) {
        yield { value, path, pathArr };
        return;
      }

      for (const [key, child] of Object.entries(value)) {
        yield* FlowValueUtils.traverse(child, {
          ...options,
          path: path ? `${path}.${key}` : key,
          pathArr: [...pathArr, key],
        });
      }
      return;
    }

    if (isArray(value)) {
      for (const [index, child] of value.entries()) {
        yield* FlowValueUtils.traverse(child, {
          ...options,
          path: path ? `${path}[${index}]` : `[${index}]`,
          pathArr: [...pathArr, `[${index}]`],
        });
      }
    }
  },

  getTemplateKeyPaths(value) {
    const keyPathReg = /\{\{([^{}]+)\}\}/g;
    return uniq(
      [...String(value?.content ?? '').matchAll(keyPathReg)].map((match) => match[0])
    ).map((token) => token.slice(2, -2).split('.'));
  },

  inferConstantJsonSchema(value) {
    if (value?.schema) return value.schema;
    if (typeof value?.content === 'string') return { type: 'string' };
    if (typeof value?.content === 'number') return { type: 'number' };
    if (typeof value?.content === 'boolean') return { type: 'boolean' };
    if (isObject(value?.content)) return { type: 'object' };
    return undefined;
  },

  inferJsonSchema(values, scope) {
    if (!isPlainObject(values)) return undefined;

    if (FlowValueUtils.isConstant(values)) return FlowValueUtils.inferConstantJsonSchema(values);

    if (FlowValueUtils.isRef(values)) {
      const variable = scope?.available?.getByKeyPath(values.content);
      return variable?.type ? JsonSchemaUtils.astToSchema(variable.type) : undefined;
    }

    if (FlowValueUtils.isTemplate(values)) return { type: 'string' };

    return {
      type: 'object',
      properties: Object.keys(values).reduce((properties, key) => {
        const schema = FlowValueUtils.inferJsonSchema(values[key], scope);
        if (schema) properties[key] = schema;
        return properties;
      }, {}),
    };
  },
};

/**
 * Return a document-safe copy with a producer key path renamed everywhere.
 * This is the pure core used by the FlowGram effect adapter.
 */
export function renameFlowValueRefs(value, beforeKeyPath, afterKeyPath) {
  const next = clone(value);

  for (const { value: item } of FlowValueUtils.traverse(next, {
    includeTypes: ['ref', 'template'],
  })) {
    if (item.type === 'ref') {
      if (hasPathPrefix(item.content, beforeKeyPath)) {
        item.content = [...afterKeyPath, ...(item.content || []).slice(beforeKeyPath.length)];
      }
      continue;
    }

    if (typeof item.content !== 'string') continue;
    item.content = item.content.replace(/\{\{([^{}]+)\}\}/g, (token, pathText) => {
      const keyPath = pathText.split('.');
      if (!hasPathPrefix(keyPath, beforeKeyPath)) return token;
      return `{{${[...afterKeyPath, ...keyPath.slice(beforeKeyPath.length)].join('.')}}}`;
    });
  }

  return next;
}

function hasPathPrefix(path = [], prefix = []) {
  return prefix.length > 0 && prefix.every((key, index) => key === path[index]);
}
