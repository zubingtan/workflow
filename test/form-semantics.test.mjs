import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test, describe } from 'node:test';
import { JsonSchemaUtils } from '@flowgram.ai/json-schema';

import {
  ConditionPresetOp,
  FORM_SEMANTIC_NODE_TYPES,
  FlowValueUtils,
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

test('headless semantic manifest covers every current node registry', () => {
  const source = readFileSync(join(process.cwd(), 'src/nodes/index.ts'), 'utf8');
  const registryImports = [...source.matchAll(/import \{ (\w+NodeRegistry) \} from/g)]
    .map(([, name]) => name)
    .filter((name) => name !== 'FlowNodeRegistry');

  assert.equal(registryImports.length, FORM_SEMANTIC_NODE_TYPES.length);
  assert.deepEqual(
    [...FORM_SEMANTIC_NODE_TYPES].sort(),
    [
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
    ].sort()
  );
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
