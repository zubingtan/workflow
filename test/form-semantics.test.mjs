import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test, describe } from 'node:test';
import { JsonSchemaUtils } from '@flowgram.ai/json-schema';

import {
  ConditionPresetOp,
  FlowValueUtils,
  defaultConditionRuleConfigs,
  defaultConditionOpConfigs,
  getLoopScopeContract,
  inferFormInputs,
  preserveWorkflowDocumentFields,
  renameFlowValueRefs,
  validateFlowValue,
} from '../src/form-semantics/headless.mjs';

const schemaScope = {
  available: {
    getByKeyPath(path) {
      if (path.join('.') !== 'start.rows') return undefined;
      return {
        type: JsonSchemaUtils.schemaToAST({
          type: 'array',
          items: { type: 'object', properties: { id: { type: 'number' } } },
        }),
      };
    },
  },
};

describe('headless workflow value semantics', () => {
  test('recognizes every wire variant and traverses nested blocks without changing paths', () => {
    const value = {
      prompt: { type: 'template', content: '{{start.query}}' },
      nested: [
        { type: 'ref', content: ['start', 'items'], extra: { index: 2 } },
        { type: 'expression', content: 'item.id' },
        { type: 'constant', content: { enabled: true }, schema: { type: 'object' } },
      ],
    };

    assert.equal(FlowValueUtils.isFlowValue(value.prompt), true);
    assert.equal(FlowValueUtils.isFlowValue(value.nested[0]), true);
    assert.deepEqual(
      [
        ...FlowValueUtils.traverse(value, {
          includeTypes: ['ref', 'template', 'expression', 'constant'],
        }),
      ].map(({ path, value: item }) => [path, item.type]),
      [
        ['prompt', 'template'],
        ['nested[0]', 'ref'],
        ['nested[1]', 'expression'],
        ['nested[2]', 'constant'],
      ]
    );
  });

  test('renames ref prefixes and every matching template token while preserving wire metadata', () => {
    const value = {
      keep: { type: 'constant', content: 'untouched', extra: { index: 4 } },
      ref: { type: 'ref', content: ['producer', 'value'], extra: { index: 2 } },
      template: {
        type: 'template',
        content: '{{producer.value}}/{{producer.value.id}}/{{other.value}}',
      },
      unknownLegalField: { nested: true },
    };

    assert.deepEqual(renameFlowValueRefs(value, ['producer', 'value'], ['producer', 'renamed']), {
      keep: { type: 'constant', content: 'untouched', extra: { index: 4 } },
      ref: { type: 'ref', content: ['producer', 'renamed'], extra: { index: 2 } },
      template: {
        type: 'template',
        content: '{{producer.renamed}}/{{producer.renamed.id}}/{{other.value}}',
      },
      unknownLegalField: { nested: true },
    });
  });

  test('infers nested input schema from constants and available scope refs', () => {
    const source = {
      name: { type: 'constant', content: 'Ada' },
      rows: { type: 'ref', content: ['start', 'rows'] },
    };

    assert.deepEqual(FlowValueUtils.inferJsonSchema(source, schemaScope), {
      type: 'object',
      properties: {
        name: { type: 'string' },
        rows: {
          type: 'array',
          items: { type: 'object', required: [], properties: { id: { type: 'number' } } },
        },
      },
    });
  });

  test('validates required, unknown ref, unknown template ref, and valid values', () => {
    const available = {
      getByKeyPath(path) {
        return path.join('.') === 'start.query' ? { type: {} } : undefined;
      },
    };

    assert.deepEqual(validateFlowValue(undefined, { required: true, available }), {
      level: 'error',
      message: 'Field is required',
    });
    assert.deepEqual(validateFlowValue({ type: 'ref', content: ['missing'] }, { available }), {
      level: 'error',
      message: 'Unknown Variable',
    });
    assert.deepEqual(
      validateFlowValue({ type: 'template', content: 'Hi {{missing.value}}' }, { available }),
      { level: 'error', message: 'Unknown Variable' }
    );
    assert.equal(
      validateFlowValue({ type: 'template', content: 'Hi {{start.query}}' }, { available }),
      undefined
    );
  });
});

describe('headless form plugins and control-flow semantics', () => {
  test('infers inputs into the target path without dropping unknown legal fields or mutating source data', () => {
    const formData = {
      title: 'Node',
      inputsValues: {
        name: { type: 'constant', content: 'Ada', extra: { index: 1 } },
        rows: { type: 'ref', content: ['start', 'rows'] },
      },
      futureField: { nested: true },
    };

    const result = inferFormInputs(formData, {
      sourceKey: 'inputsValues',
      targetKey: 'inputs',
      scope: schemaScope,
    });

    assert.deepEqual(formData, {
      title: 'Node',
      inputsValues: {
        name: { type: 'constant', content: 'Ada', extra: { index: 1 } },
        rows: { type: 'ref', content: ['start', 'rows'] },
      },
      futureField: { nested: true },
    });
    assert.deepEqual(result.futureField, { nested: true });
    assert.deepEqual(result.inputs, {
      type: 'object',
      properties: {
        name: { type: 'string' },
        rows: {
          type: 'array',
          items: { type: 'object', required: [], properties: { id: { type: 'number' } } },
        },
      },
    });
  });

  test('freezes the complete condition operator set and unary right-hand semantics', () => {
    assert.deepEqual(
      Object.keys(defaultConditionOpConfigs).sort(),
      Object.values(ConditionPresetOp).sort()
    );
    assert.equal(defaultConditionOpConfigs[ConditionPresetOp.IS_EMPTY].rightDisplay, 'Empty');
    assert.equal(defaultConditionOpConfigs[ConditionPresetOp.IS_TRUE].rightDisplay, 'True');
  });

  test('keeps Loop private-scope declaration and iteration variable names stable', () => {
    assert.deepEqual(getLoopScopeContract('loop_0'), {
      declarationKey: 'loop_0_locals',
      itemKey: 'item',
      indexKey: 'index',
    });
  });
});

test('headless seam covers every current node registry and form meta', () => {
  const source = readFileSync(join(process.cwd(), 'src/nodes/index.ts'), 'utf8');
  const registryImports = [...source.matchAll(/import \{ (\w+NodeRegistry) \} from '(.+)'/g)].filter(
    ([, name]) => name !== 'FlowNodeRegistry'
  );
  const registryTypes = registryImports.map(([, , importPath]) => importPath.slice(2));

  assert.deepEqual(registryTypes.sort(), [
    'block-end',
    'block-start',
    'break',
    'code',
    'comment',
    'condition',
    'continue',
    'end',
    'feishu-bot',
    'feishu-trigger',
    'group',
    'http',
    'llm',
    'loop',
    'multi-condition',
    'start',
    'variable',
  ].sort());

  for (const [, registryName, importPath] of registryImports) {
    const nodeDirectory = importPath.slice(2);
    const registrySource = ['index.ts', 'index.tsx']
      .map((file) => join(process.cwd(), 'src/nodes', nodeDirectory, file))
      .find((file) => {
        try {
          statSync(file);
          return true;
        } catch {
          return false;
        }
      });
    assert.ok(registrySource, `${nodeDirectory} registry source exists`);
    assert.match(readFileSync(registrySource, 'utf8'), new RegExp(`${registryName}\\s*:`));

    const formMetaSource = ['form-meta.ts', 'form-meta.tsx']
      .map((file) => join(process.cwd(), 'src/nodes', nodeDirectory, file))
      .find((file) => {
        try {
          statSync(file);
          return true;
        } catch {
          return false;
        }
      });
    if (formMetaSource) {
      assert.match(readFileSync(formMetaSource, 'utf8'), /export const formMeta|export const LLMFormMeta/);
    } else {
      assert.match(readFileSync(registrySource, 'utf8'), /formMeta:/);
    }
  }
});

test('Condition and MultiCondition use local schema operator semantics', () => {
  assert.deepEqual(Object.keys(defaultConditionRuleConfigs).sort(), [
    'array',
    'boolean',
    'date-time',
    'integer',
    'map',
    'number',
    'object',
    'string',
  ]);
  assert.deepEqual(defaultConditionRuleConfigs.boolean.is_true, null);
  assert.deepEqual(defaultConditionRuleConfigs.boolean.is_false, null);
  assert.deepEqual(defaultConditionRuleConfigs.string.in, {
    type: 'array',
    items: { type: 'string' },
  });
  assert.deepEqual(defaultConditionRuleConfigs.integer.nin, {
    type: 'array',
    extra: { weak: true },
  });
});

test('document save preserves unknown top-level fields while canonical fields win', () => {
  assert.deepEqual(
    preserveWorkflowDocumentFields(
      { nodes: ['old'], futureField: { preserved: true }, globalVariable: { old: true } },
      { nodes: ['new'], globalVariable: { new: true } }
    ),
    { nodes: ['new'], futureField: { preserved: true }, globalVariable: { new: true } }
  );
});

test('legacy form-materials access is isolated to one explicit adapter', () => {
  const root = join(process.cwd(), 'src');
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.(mjs|ts|tsx)$/.test(entry)) files.push(path);
    }
  }

  visit(root);
  const imports = files
    .filter((path) => readFileSync(path, 'utf8').includes('@flowgram.ai/form-materials'))
    .map((path) => relative(process.cwd(), path));

  assert.deepEqual(imports, ['src/form-semantics/legacy-adapter.tsx']);
});
