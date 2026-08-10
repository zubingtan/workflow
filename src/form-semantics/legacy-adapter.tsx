/**
 * Temporary renderer adapter for #283.
 *
 * #285 replaces these visual controls. Keeping the package import in this one
 * file prevents the legacy renderer from becoming a second semantic source of
 * truth while the application-owned headless module is adopted.
 */
export {
  AssignRows,
  BatchOutputs,
  BatchVariableSelector,
  ConditionRow,
  DisplayInputsValues,
  DisplayOutputs,
  DisplaySchemaTag,
  DynamicValueInput,
  JsonCodeEditor,
  JsonSchemaEditor,
  InputsValues,
  JsonEditorWithVariables,
  PromptEditorWithVariables,
  TypeScriptCodeEditor,
  unstableSetCreateRoot,
  useVariableTree,
} from '@flowgram.ai/form-materials';
