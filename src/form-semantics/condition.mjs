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

const weakArray = Object.freeze({ type: 'array', extra: { weak: true } });

/** Schema-driven operator rules used by both Condition node variants. */
export const defaultConditionRuleConfigs = Object.freeze({
  string: Object.freeze({
    eq: { type: 'string' },
    neq: { type: 'string' },
    contains: { type: 'string' },
    not_contains: { type: 'string' },
    in: { type: 'array', items: { type: 'string' } },
    nin: { type: 'array', items: { type: 'string' } },
    is_empty: null,
    is_not_empty: null,
  }),
  number: Object.freeze({
    eq: { type: 'number' },
    neq: { type: 'number' },
    gt: { type: 'number' },
    gte: { type: 'number' },
    lt: { type: 'number' },
    lte: { type: 'number' },
    in: weakArray,
    nin: weakArray,
  }),
  integer: Object.freeze({
    eq: { type: 'number' },
    neq: { type: 'number' },
    gt: { type: 'number' },
    gte: { type: 'number' },
    lt: { type: 'number' },
    lte: { type: 'number' },
    in: weakArray,
    nin: weakArray,
  }),
  boolean: Object.freeze({
    eq: { type: 'boolean' },
    neq: { type: 'boolean' },
    is_true: null,
    is_false: null,
    in: { type: 'array', items: { type: 'boolean' } },
    nin: { type: 'array', items: { type: 'boolean' } },
  }),
  array: Object.freeze({
    is_empty: null,
    is_not_empty: null,
    contains: weakArray,
    not_contains: weakArray,
    eq: weakArray,
    neq: weakArray,
  }),
  map: Object.freeze({
    is_empty: null,
    is_not_empty: null,
  }),
  object: Object.freeze({
    is_empty: null,
    is_not_empty: null,
  }),
  'date-time': Object.freeze({
    eq: { type: 'date-time' },
    neq: { type: 'date-time' },
    gt: { type: 'date-time' },
    gte: { type: 'date-time' },
    lt: { type: 'date-time' },
    lte: { type: 'date-time' },
    is_empty: null,
    is_not_empty: null,
  }),
});

export const conditionRowRuleConfig = Object.freeze({
  ops: defaultConditionOpConfigs,
  rules: defaultConditionRuleConfigs,
});
