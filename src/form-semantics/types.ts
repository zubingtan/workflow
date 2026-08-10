import type { IJsonSchema } from '@flowgram.ai/json-schema';

export type { IJsonSchema, JsonSchemaBasicType } from '@flowgram.ai/json-schema';

export interface IFlowValueExtra {
  index?: number;
}

export type FlowValueType = 'constant' | 'ref' | 'expression' | 'template';

export interface IFlowConstantValue {
  type: 'constant';
  content?: any;
  schema?: IJsonSchema;
  extra?: IFlowValueExtra;
}

export interface IFlowRefValue {
  type: 'ref';
  content?: string[];
  extra?: IFlowValueExtra;
}

export interface IFlowExpressionValue {
  type: 'expression';
  content?: string;
  extra?: IFlowValueExtra;
}

export interface IFlowTemplateValue {
  type: 'template';
  content?: string;
  extra?: IFlowValueExtra;
}

export type IFlowValue =
  | IFlowConstantValue
  | IFlowRefValue
  | IFlowExpressionValue
  | IFlowTemplateValue;

export type IFlowConstantRefValue = IFlowConstantValue | IFlowRefValue;

export interface IInputsValues {
  [key: string]: IInputsValues | IFlowValue | undefined;
}

export interface ConditionRowValueType {
  left?: IFlowRefValue;
  operator?: string;
  right?: IFlowConstantRefValue;
}

export type AssignValueType =
  | {
      operator: 'assign';
      left?: IFlowRefValue;
      right?: IFlowValue;
    }
  | {
      operator: 'declare';
      left?: string;
      right?: IFlowValue;
    };

export interface ConditionOpConfig {
  label: string;
  abbreviation: string;
  rightDisplay?: string;
}

export type ConditionOpConfigs = Record<string, ConditionOpConfig>;

export type IConditionRule = Record<string, string | IJsonSchema | null>;
export type IConditionRuleFactory = (schema?: IJsonSchema) => IConditionRule;
