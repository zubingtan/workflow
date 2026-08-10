export { ConditionPresetOp, defaultConditionOpConfigs } from './condition.mjs';
export { FlowValueUtils, renameFlowValueRefs } from './flow-value.mjs';
export { inferFormInputs } from './infer.mjs';
export { getLoopScopeContract } from './loop-scope.mjs';
export { validateFlowValue } from './validation.mjs';
export { preserveWorkflowDocumentFields } from './workflow-document.mjs';

export const FORM_SEMANTIC_NODE_TYPES = Object.freeze([
  'condition',
  'start',
  'end',
  'llm',
  'loop',
  'comment',
  'block-start',
  'block-end',
  'http',
  'code',
  'continue',
  'break',
  'variable',
  'group',
  'multi-condition',
  'feishu-trigger',
  'feishu-bot',
]);
