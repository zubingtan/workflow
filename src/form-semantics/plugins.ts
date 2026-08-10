import { get, set, uniqBy } from 'lodash-es';
import { JsonSchemaUtils } from '@flowgram.ai/json-schema';
import {
  ASTFactory,
  FlowNodeScopeType,
  ScopeChainTransformService,
  createEffectFromVariableProvider,
  defineFormPluginCreator,
  getNodePrivateScope,
  getNodeScope,
} from '@flowgram.ai/editor';
import type { EffectOptions, FormPluginCreator } from '@flowgram.ai/editor';

import type { AssignValueType, IFlowRefValue } from './types';
import { FlowValueUtils, inferFormInputs } from './headless.mjs';

interface InputConfig {
  sourceKey: string;
  targetKey: string;
  scope?: 'private' | 'public';
  ignoreConstantSchema?: boolean;
}

export const createInferInputsPlugin = defineFormPluginCreator<InputConfig>({
  onSetupFormMeta(
    { addFormatOnSubmit, addFormatOnInit },
    { sourceKey, targetKey, scope, ignoreConstantSchema }
  ) {
    if (!sourceKey || !targetKey) return;

    addFormatOnSubmit((formData, ctx) =>
      inferFormInputs(formData, {
        sourceKey,
        targetKey,
        scope: scope === 'private' ? getNodePrivateScope(ctx.node) : getNodeScope(ctx.node),
        ignoreConstantSchema,
      })
    );

    if (ignoreConstantSchema) {
      addFormatOnInit((formData, ctx) => {
        const targetSchema = get(formData, targetKey);
        if (!targetSchema) return formData;

        const next = structuredClone(formData);
        for (const { value, pathArr } of FlowValueUtils.traverse(get(formData, sourceKey), {
          includeTypes: ['constant'],
        })) {
          if (!FlowValueUtils.isConstant(value) || value.schema) continue;
          const schemaPath = pathArr.map((item: string) => `properties.${item}`).join('.');
          const schema = get(targetSchema, schemaPath);
          if (schema) set(next, `${sourceKey}.${pathArr.join('.')}.schema`, schema);
        }
        return next;
      });
    }
  },
});

export const createInferAssignPlugin = defineFormPluginCreator<{
  assignKey: string;
  outputKey: string;
}>({
  onSetupFormMeta({ addFormatOnSubmit, mergeEffect }, { assignKey, outputKey }) {
    if (!assignKey || !outputKey) return;

    mergeEffect({
      [assignKey]: createEffectFromVariableProvider({
        parse: (value: AssignValueType[], ctx: any) => {
          const declareRows = uniqBy(
            value.filter((item) => item.operator === 'declare' && item.left && item.right),
            'left'
          );

          return [
            ASTFactory.createVariableDeclaration({
              key: `${ctx.node.id}`,
              meta: {
                title: ctx.node.form?.getValueIn('title'),
                icon: ctx.node.getNodeRegistry().info?.icon,
              },
              type: ASTFactory.createObject({
                properties: declareRows.map((item) =>
                  ASTFactory.createProperty({
                    key: item.left as string,
                    type:
                      item.right?.type === 'constant'
                        ? JsonSchemaUtils.schemaToAST(item.right.schema || {})
                        : undefined,
                    initializer:
                      item.right?.type === 'ref'
                        ? ASTFactory.createKeyPathExpression({
                            keyPath: item.right.content || [],
                          })
                        : {},
                  })
                ),
              }),
            }),
          ];
        },
      }),
    });

    addFormatOnSubmit((formData, ctx) => {
      const next = structuredClone(formData);
      set(
        next,
        outputKey,
        JsonSchemaUtils.astToSchema(getNodeScope(ctx.node).output.variables?.[0]?.type)
      );
      return next;
    });
  },
});

export const provideBatchOutputsEffect: EffectOptions[] = createEffectFromVariableProvider({
  parse: (value: Record<string, IFlowRefValue>, ctx: any) => [
    ASTFactory.createVariableDeclaration({
      key: `${ctx.node.id}`,
      meta: {
        title: ctx.node.form?.getValueIn('title'),
        icon: ctx.node.getNodeRegistry().info?.icon,
      },
      type: ASTFactory.createObject({
        properties: Object.entries(value).map(([key, item]) =>
          ASTFactory.createProperty({
            key,
            initializer: ASTFactory.createWrapArrayExpression({
              wrapFor: ASTFactory.createKeyPathExpression({
                keyPath: item?.content || [],
              }),
            }),
          })
        ),
      }),
    }),
  ],
});

export const createBatchOutputsFormPlugin: FormPluginCreator<{
  outputKey: string;
  inferTargetKey?: string;
}> = defineFormPluginCreator({
  name: 'batch-outputs-plugin',
  onSetupFormMeta({ mergeEffect, addFormatOnSubmit }, { outputKey, inferTargetKey }) {
    mergeEffect({ [outputKey]: provideBatchOutputsEffect });

    if (inferTargetKey) {
      addFormatOnSubmit((formData, ctx) => {
        const outputVariable = getNodeScope(ctx.node).output.variables?.[0];
        if (!outputVariable?.type) return formData;

        const next = structuredClone(formData);
        set(next, inferTargetKey, JsonSchemaUtils.astToSchema(outputVariable.type));
        return next;
      });
    }
  },
  onInit(ctx, { outputKey }) {
    const chainTransformService = ctx.node.getService(ScopeChainTransformService);
    const batchNodeType = ctx.node.flowNodeType;
    const transformerId = `${batchNodeType}-outputs`;

    if (chainTransformService.hasTransformer(transformerId)) return;

    chainTransformService.registerTransformer(transformerId, {
      transformCovers: (covers, transformContext) => {
        const node = transformContext.scope.meta?.node;
        if (node?.parent?.flowNodeType === batchNodeType) {
          return [...covers, getNodeScope(node.parent)];
        }
        return covers;
      },
      transformDeps(scopes, transformContext) {
        const scopeMeta = transformContext.scope.meta;
        if (scopeMeta?.type === FlowNodeScopeType.private) return scopes;

        const node = scopeMeta?.node;
        if (node?.flowNodeType !== batchNodeType) return scopes;

        return [
          getNodePrivateScope(node),
          ...node.blocks.map((childBlock) => getNodeScope(childBlock)),
        ];
      },
    });
  },
});
