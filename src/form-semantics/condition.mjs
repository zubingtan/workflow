/** Persisted condition operators shared by Condition and MultiCondition. */
export const ConditionPresetOp = Object.freeze({
  EQ: 'eq',
  NEQ: 'neq',
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
  IN: 'in',
  NIN: 'nin',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'not_contains',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
  IS_TRUE: 'is_true',
  IS_FALSE: 'is_false',
});

export const defaultConditionOpConfigs = Object.freeze({
  eq: { label: 'Equal', abbreviation: '=' },
  neq: { label: 'Not Equal', abbreviation: '≠' },
  gt: { label: 'Greater Than', abbreviation: '>' },
  gte: { label: 'Greater Than or Equal', abbreviation: '>=' },
  lt: { label: 'Less Than', abbreviation: '<' },
  lte: { label: 'Less Than or Equal', abbreviation: '<=' },
  in: { label: 'In', abbreviation: '∈' },
  nin: { label: 'Not In', abbreviation: '∉' },
  contains: { label: 'Contains', abbreviation: '⊇' },
  not_contains: { label: 'Not Contains', abbreviation: '⊉' },
  is_empty: { label: 'Is Empty', abbreviation: '=', rightDisplay: 'Empty' },
  is_not_empty: { label: 'Is Not Empty', abbreviation: '≠', rightDisplay: 'Empty' },
  is_true: { label: 'Is True', abbreviation: '=', rightDisplay: 'True' },
  is_false: { label: 'Is False', abbreviation: '=', rightDisplay: 'False' },
});
