import { get, omit, set } from 'lodash-es';

import { FlowValueUtils } from './flow-value.mjs';

function clone(value) {
  return structuredClone(value);
}

/**
 * Infer a schema field from a form value while preserving the complete form
 * document. This is the pure core used by the FlowGram form-plugin adapter.
 */
export function inferFormInputs(
  formData,
  { sourceKey, targetKey, scope, ignoreConstantSchema = false }
) {
  const next = clone(formData);
  const sourceData = get(formData, sourceKey);

  set(next, targetKey, FlowValueUtils.inferJsonSchema(sourceData, scope));

  if (ignoreConstantSchema) {
    for (const { path } of FlowValueUtils.traverse(sourceData, { includeTypes: ['constant'] })) {
      const current = get(next, `${sourceKey}.${path}`);
      if (FlowValueUtils.isConstant(current) && current.schema) {
        set(next, `${sourceKey}.${path}`, omit(current, ['schema']));
      }
    }
  }

  return next;
}
