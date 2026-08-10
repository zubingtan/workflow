import { FeedbackLevel, getNodeScope } from '@flowgram.ai/editor';

import { FlowValueUtils } from './flow-value.mjs';

function isNil(value) {
  return value === null || value === undefined;
}

function getAvailable(ctx) {
  if (ctx.available) return ctx.available;
  if (ctx.scope?.available) return ctx.scope.available;
  return getNodeScope(ctx.node).available;
}

/** Validate a persisted FlowValue against the current public variable scope. */
export function validateFlowValue(value, ctx = {}) {
  const { required, errorMessages } = ctx;
  const {
    required: requiredMessage = 'Field is required',
    unknownVariable: unknownVariableMessage = 'Unknown Variable',
  } = errorMessages || {};

  if (required && (isNil(value) || isNil(value?.content) || value?.content === '')) {
    return { level: FeedbackLevel.Error, message: requiredMessage };
  }

  const available = getAvailable(ctx);
  if (value?.type === 'ref' && !available.getByKeyPath(value.content || [])) {
    return { level: FeedbackLevel.Error, message: unknownVariableMessage };
  }

  if (value?.type === 'template') {
    for (const ref of FlowValueUtils.getTemplateKeyPaths(value)) {
      if (!available.getByKeyPath(ref)) {
        return { level: FeedbackLevel.Error, message: unknownVariableMessage };
      }
    }
  }

  return undefined;
}
