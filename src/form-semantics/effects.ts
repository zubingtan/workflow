import { JsonSchemaUtils } from '@flowgram.ai/json-schema';
import {
  ASTFactory,
  BaseType,
  DataEvent,
  Effect,
  EffectOptions,
  FlowNodeRegistry,
  FlowNodeVariableData,
  VariableFieldKeyRenameService,
  createEffectFromVariableProvider,
  getNodePrivateScope,
  getNodeScope,
} from '@flowgram.ai/editor';

import type { IFlowRefValue, IJsonSchema } from './types';
import { getLoopScopeContract, renameFlowValueRefs } from './headless.mjs';

export const autoRenameRefEffect: EffectOptions[] = [
  {
    event: DataEvent.onValueInit,
    effect: ((params) => {
      const { context, form, name } = params;
      const renameService = context.node.getService(VariableFieldKeyRenameService);

      const disposable = renameService.onRename(({ before, after }) => {
        const beforeKeyPath = [
          ...before.parentFields.map((field) => field.key).reverse(),
          before.key,
        ];
        const afterKeyPath = [...after.parentFields.map((field) => field.key).reverse(), after.key];
        const value = form.getValueIn(name);
        const nextValue = renameFlowValueRefs(value, beforeKeyPath, afterKeyPath);

        if (JSON.stringify(value) !== JSON.stringify(nextValue)) {
          form.setValueIn(name, nextValue);
        }
      });

      return () => disposable.dispose();
    }) as Effect,
  },
];

export const syncVariableTitle: EffectOptions[] = [
  {
    event: DataEvent.onValueChange,
    effect: (({ value, context }) => {
      context.node.getData(FlowNodeVariableData).allScopes.forEach((_scope: any) => {
        _scope.output.variables.forEach((_variable: any) => {
          _variable.updateMeta({
            ...(_variable.meta || {}),
            title: value || context.node.id,
            icon: context.node.getNodeRegistry<FlowNodeRegistry>().info?.icon,
          });
        });
      });
    }) as Effect,
  },
];

export const provideJsonSchemaOutputs: EffectOptions[] = createEffectFromVariableProvider({
  parse: (value: IJsonSchema, ctx: any) => [
    ASTFactory.createVariableDeclaration({
      key: `${ctx.node.id}`,
      meta: {
        title: ctx.node.form?.getValueIn('title') || ctx.node.id,
        icon: ctx.node.getNodeRegistry().info?.icon,
      },
      type: JsonSchemaUtils.schemaToAST(value),
    }),
  ],
});

export const provideBatchInputEffect: EffectOptions[] = createEffectFromVariableProvider({
  private: true,
  parse: (value: IFlowRefValue, ctx: any) => {
    const { declarationKey, itemKey, indexKey } = getLoopScopeContract(ctx.node.id);
    return [
      ASTFactory.createVariableDeclaration({
        key: declarationKey,
        meta: {
          title: ctx.node.form?.getValueIn('title'),
          icon: ctx.node.getNodeRegistry().info?.icon,
        },
        type: ASTFactory.createObject({
          properties: [
            ASTFactory.createProperty({
              key: itemKey,
              initializer: ASTFactory.createEnumerateExpression({
                enumerateFor: ASTFactory.createKeyPathExpression({
                  keyPath: value.content || [],
                }),
              }),
            }),
            ASTFactory.createProperty({
              key: indexKey,
              type: ASTFactory.createNumber(),
            }),
          ],
        }),
      }),
    ];
  },
});

export const validateWhenVariableSync = ({
  scope,
}: {
  scope?: 'private' | 'public';
} = {}): EffectOptions[] => [
  {
    event: DataEvent.onValueInit,
    effect: (({ context, form, name }) => {
      const nodeScope =
        scope === 'private' ? getNodePrivateScope(context.node) : getNodeScope(context.node);

      const disposable = nodeScope.available.onListOrAnyVarChange(() => {
        const errorKeys = Object.entries(form.state.errors || {})
          .filter(([, errors]) => errors?.length > 0)
          .filter(([key]) => key.startsWith(name) || name.startsWith(key))
          .map(([key]) => key);

        if (errorKeys.length > 0) form.validate();
      });
      return () => disposable.dispose();
    }) as Effect,
  },
];

export const listenRefSchemaChange = (
  cb: (props: any & { schema?: IJsonSchema }) => void
): EffectOptions[] => [
  {
    event: DataEvent.onValueInitOrChange,
    effect: ((params: any) => {
      const { context, value } = params;
      if (value?.type !== 'ref') return () => null;

      const disposable = getNodeScope(context.node).available.trackByKeyPath<BaseType | undefined>(
        value.content || [],
        (type) => cb({ ...params, schema: JsonSchemaUtils.astToSchema(type) }),
        { selector: (item) => item?.type }
      );
      return () => disposable.dispose();
    }) as Effect,
  },
];

export const listenRefValueChange = (
  cb: (props: any & { variable?: any }) => void
): EffectOptions[] => [
  {
    event: DataEvent.onValueInitOrChange,
    effect: ((params: any) => {
      const { context, value } = params;
      if (value?.type !== 'ref') return () => null;

      const disposable = getNodeScope(context.node).available.trackByKeyPath(
        value.content || [],
        (variable) => cb({ ...params, variable })
      );
      return () => disposable.dispose();
    }) as Effect,
  },
];
