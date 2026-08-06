# `@flowgram.ai/form-materials` 退出策略与 Workflow JSON 风险

> Wayfinder research ticket: [#257](https://github.com/zubingtan/workflow/issues/257)  
> 研究基线：`origin/main@0a3c48754f9b9844b63493dcf2af4e71dbd76e36`  
> 目标版本：`@flowgram.ai/form-materials@1.0.12`

## 结论

`@flowgram.ai/form-materials` 可以退出，但不能把它当成一个普通的 Semi UI 组件包直接替换。它同时承载四层职责：

1. 依赖 Semi 的编辑器和只读 renderer；
2. 写入 Workflow JSON 的 `IFlowValue`、condition、assign 等协议类型；
3. JSON Schema 推断、引用校验和序列化插件；
4. 把 `data.outputs`、循环变量等注册进 FlowGram variable scope 的运行时集成。

推荐路线是：

1. **直接替换**：从 `@flowgram.ai/json-schema@1.0.12` 直接导入 `IJsonSchema`、`JsonSchemaBasicType`、`JsonSchemaUtils`；
2. **抽取并冻结**：在应用内定义与 1.0.12 完全同形的 Workflow value、condition、assign 持久化类型；
3. **抽取无头语义层**：按 1.0.12 行为迁入最小的 FlowGram effects/form plugins，并先用特征测试锁定 `toJSON()` 和 variable scope；
4. **应用内重写 UI**：用 shadcn 组件替换 renderer/editor，但继续读写原有 Field 路径和 JSON envelope；
5. **不等待上游**：同步向 FlowGram 提议拆出不依赖 UI 库的 headless 包，但本次迁移不以其为阻塞项。

不能采用的路线是只替换 34 个生产 import 中的 React 组件、随后删除依赖。那样界面可能正常，但保存后的 `inputs`/`outputs`、下游变量、引用重命名、循环作用域或条件值已经改变。

## 已确认事实

### 包边界并不“无头”

生产 `src/` 有 **34 个文件**直接 import `@flowgram.ai/form-materials`。其根 barrel 同时导出 components、effects、form plugins、schema API、value helpers 和 React 18 bridge；包自身 `package.json` 又直接依赖 `@douyinfe/semi-ui` 与 `@douyinfe/semi-icons`。分布式源码中有 **31 个文件**直接 import Semi。

因此，即使应用只从该包导入一个 type 或纯函数，依赖图仍会保留整个 `form-materials -> Semi` 边。`sideEffects: false` 可能帮助 bundler tree-shake 运行时代码，但不会从 lockfile 或安装依赖树删除 Semi。

证据：

- `node_modules/@flowgram.ai/form-materials/package.json`：版本、exports、`sideEffects` 和 dependencies；
- `node_modules/@flowgram.ai/form-materials/src/index.ts`：混合导出的根 barrel；
- `pnpm-lock.yaml`：`@flowgram.ai/form-materials@1.0.12` 的 resolved entry 明确依赖两个 Semi 包；
- [FlowGram 官方 form-materials 介绍](https://github.com/bytedance/flowgram.ai/blob/main/apps/docs/src/en/materials/introduction.mdx)。

### JSON Schema 已有无 Semi 的直接上游

`form-materials` 中的 `IJsonSchema`、`JsonSchemaBasicType` 和 `JsonSchemaUtils` 只是从 `@flowgram.ai/json-schema` 再导出。后者的 package metadata 不依赖 Semi，且提供 AST 与 schema 的转换能力。因此这里应新增同版本直接依赖，不应复制类型或继续经由 `form-materials` 间接导入。

证据：

- `node_modules/@flowgram.ai/form-materials/src/plugins/json-schema-preset/index.tsx`；
- `node_modules/.pnpm/@flowgram.ai+json-schema@1.0.12_*/node_modules/@flowgram.ai/json-schema/dist/index.d.ts`；
- [FlowGram 官方 Variable Selector / JSON Schema API](https://github.com/bytedance/flowgram.ai/blob/main/apps/docs/src/zh/materials/components/variable-selector.mdx)。

### `runtime-interface` 不能完整替代当前 value types

仓库已经直接依赖的 `@flowgram.ai/runtime-interface@1.0.12` 也导出 `IFlowValue`，但它的 `constant.content` 只允许 string/number/boolean，而且各 variant 没有 `schema` 与 `extra.index`。`form-materials` 的实际持久化类型允许任意 constant、内嵌 schema 和排序 metadata；当前 workflow 也确实使用 `extra.index`。

因此可以在局部使用 runtime-interface 中严格相同的窄类型，但不能把它当成 `form-materials` value types 的无损整体替代。为了防止 TypeScript 在迁移时“合法地”删掉已有字段，本仓库应冻结完整的应用级 wire type，并用 fixture round-trip 证明兼容。

证据：`@flowgram.ai/runtime-interface@1.0.12/dist/index.d.ts`、`node_modules/@flowgram.ai/form-materials/src/shared/flow-value/types.ts`、[`src/initial-data.ts`](../src/initial-data.ts)。

## 能力退出矩阵

| 能力                                                                     | 当前生产用途                                       | 决策                                                     | 必须保持的契约                                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `IJsonSchema`, `JsonSchemaBasicType`, `JsonSchemaUtils`                  | node types、test run、全局变量 AST↔schema          | **直接替换**为 `@flowgram.ai/json-schema@1.0.12`         | schema 字段不丢失；AST 转换行为不变                                               |
| `IFlowValue`, `IFlowTemplateValue`, `IFlowRefValue`                      | `data.inputsValues`、prompt、HTTP、Code、End、Loop | **应用内抽取并冻结类型**                                 | `constant/ref/expression/template` discriminant 和 `content` 形状完全不变         |
| `ConditionRowValueType`, `AssignValueType`                               | Condition/Multi-condition/Variable node JSON       | **应用内抽取并冻结类型**                                 | operator 字符串、left/right envelope、assign/declare union 不变                   |
| `FlowValueUtils` 所需子集                                                | template key-path、遍历、schema inference、校验    | **抽取最小纯逻辑**，附 MIT 来源说明                      | `{{a.b}}` 解析、ref path、constant schema inference 不变                          |
| `provideJsonSchemaOutputs`                                               | 将 `data.outputs` 注册为下游变量                   | **抽取无头 FlowGram effect**                             | declaration key 仍为 node id；schema 与 metadata 同步                             |
| `syncVariableTitle`                                                      | node title 改名后更新 variable metadata            | **抽取无头 FlowGram effect**                             | 只改 metadata，不改 JSON ref key-path                                             |
| `autoRenameRefEffect`                                                    | producer 字段改名时更新 ref/template               | **抽取无头 FlowGram effect**                             | ref 数组与模板中的完整前缀路径同步替换                                            |
| `listenRefSchemaChange`, `validateFlowValue`, `validateWhenVariableSync` | 引用类型跟踪、未知变量错误、scope 更新后重验       | **抽取无头语义**                                         | 使用当前 node 的 public/private scope；错误时机不退化                             |
| `createInferInputsPlugin`                                                | save 时由 `inputsValues` 推导 `inputs`             | **抽取 form plugin**                                     | `formatOnSubmit` 结果逐字段等价；constant schema 规则不变                         |
| `createInferAssignPlugin`                                                | Variable node 声明变量并保存 `outputs`             | **抽取 form plugin**                                     | declare/assign 的 scope 和输出 schema 等价                                        |
| `provideBatchInputEffect`, `createBatchOutputsFormPlugin`                | Loop 私有 `{item,index}` 与跨 child scope 输出     | **抽取 form plugin/effect**，最后迁移                    | private/public scope chain 与 array wrap 语义不变                                 |
| `DynamicValueInput`, variable selector                                   | constant/ref 切换和变量选择                        | **shadcn 应用内重写**                                    | 只产生原 envelope；ref `content` 是 `string[]`；保留 `extra.index`                |
| `PromptEditorWithVariables`                                              | LLM、HTTP prompt/template                          | **应用内重写**；可直接使用无 Semi 的编辑器底层           | 外部值同步、变量插入和 `{type:'template',content}` 不变                           |
| `JsonEditorWithVariables`                                                | HTTP body                                          | **应用内重写**                                           | 带 `{{path}}` 的 JSON 模板可编辑且保存为 template，不把占位符错误标准化           |
| `InputsValues`, `AssignRows`, `ConditionRow`, Loop editors               | 复杂 node settings                                 | **shadcn 应用内重写，后迁移**                            | Field 路径、顺序 metadata、operator/type rule 和 readonly 行为不变                |
| `JsonSchemaEditor`                                                       | Start、Code outputs、global variables              | **应用内重写，不能复用 LLM flat editor 代替**            | nested object/array、required、default、description、enum、format、extra 等不丢失 |
| `DisplayOutputs`, `DisplayInputsValues`, `DisplaySchemaTag`              | canvas card、readonly/history、test run            | **shadcn renderer 重写**                                 | 只读展示来自同一 schema/scope，不写数据                                           |
| `TypeScriptCodeEditor`, `JsonCodeEditor`                                 | Code node、test-run object/array                   | **直接使用 CodeMirror 6 或无 Semi editor core 重写外壳** | language mode、外部值同步、onChange 文本和主题切换不变                            |
| `useVariableTree`                                                        | variable panel                                     | **重写 hook/view-model**，不要复制返回类型               | 当前实现返回 Semi `TreeNodeData` 并渲染 Semi Icon；新 hook 返回应用内纯数据       |
| `unstableSetCreateRoot`                                                  | 给 form-materials portal/editor 注入 React 18 root | **所有 package UI 退出后删除**                           | 不应形成新的全局 bridge                                                           |

## Workflow JSON 与下游变量的风险边界

### 1. `IFlowValue` 是持久化协议，不是组件内部状态

1.0.12 的 wire union 是：

```ts
type IFlowValue =
  | { type: 'constant'; content?: unknown; schema?: IJsonSchema; extra?: { index?: number } }
  | { type: 'ref'; content?: string[]; extra?: { index?: number } }
  | { type: 'expression'; content?: string; extra?: { index?: number } }
  | { type: 'template'; content?: string; extra?: { index?: number } };
```

当前默认 workflow 已实际持久化这些形状：prompt 使用 `{{start_0.query}}`，condition 使用 `['llm_main', 'is_english_word']`，Code/End 使用 ref key-path，多个 input 还用 `extra.index` 保持顺序。新 UI 不得把 ref 改成点分字符串、把 template 改成普通字符串，或在重排时丢掉 `extra`。

证据：[`src/initial-data.ts`](../src/initial-data.ts)、`node_modules/@flowgram.ai/form-materials/src/shared/flow-value/types.ts`。

### 2. `outputs` 同时驱动画布、变量系统和后端执行

`provideJsonSchemaOutputs` 把 `data.outputs` 转换为以 node id 为 key 的 FlowGram variable declaration。后端运行时又优先读取 FlowGram 放进 `node.declare.outputs` 的 schema，并以 `data.outputs` 作为 defensive fallback。因此它不是一个仅供设置面板展示的字段。

如果只重写 `JsonSchemaEditor`，却漏掉 effect，下游变量选择器将看不到字段；如果 UI 修改 schema 形状，结构化输出执行也会改变。

证据：

- `node_modules/@flowgram.ai/form-materials/src/effects/provide-json-schema-outputs/index.ts`；
- [`server/runtime-adapter.mjs`](../server/runtime-adapter.mjs)；
- [FlowGram 官方 `provideJsonSchemaOutputs` 文档](https://github.com/bytedance/flowgram.ai/blob/main/apps/docs/src/zh/materials/effects/provide-json-schema-outputs.mdx)。

### 3. LLM structured output 只是通用 schema editor 的一个受限子集

当前 LLM editor 已采用应用内 field-list，并继续持久化原 `IJsonSchema`，这是退出 `form-materials` 的有效先例。但后端只接受 flat primitive fields，并把所有字段设为 required、`additionalProperties: false`。空 properties 还表示“不启用 structured contract”。

Start、Code 和 global variable 的通用 editor 则必须继续支持 nested object/array、required、default、description 等。不能为了复用 UI，把所有 schema 降级成 LLM 的 flat editor。

证据：

- [`src/nodes/llm/schema-state.mjs`](../src/nodes/llm/schema-state.mjs)；
- [`server/structured-output.mjs`](../server/structured-output.mjs)；
- `node_modules/@flowgram.ai/form-materials/src/components/json-schema-editor/index.tsx`。

### 4. ref rename、schema inference 和 scope 是隐形语义

- producer key 改名时，`autoRenameRefEffect` 同时修改 ref 数组与 template 中的 `{{path}}`；
- `createInferInputsPlugin` 在 submit 阶段从 `inputsValues` 生成 `inputs`；
- `createInferAssignPlugin` 从 Variable node rows 产生 output variables 和持久化 schema；
- Loop 使用 private `{item,index}` scope，并改写 parent/child scope dependency。

这些行为不一定在 UI smoke test 中暴露，却会直接影响保存后的 JSON 和下游可访问变量。因此必须先抽出语义层，再拆 UI。

## 34 个生产 import 的迁移归属

| 文件                                                                      | 当前导入                                          | 归属                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `src/app.tsx`                                                             | `unstableSetCreateRoot`                           | package UI 全退后删除                                           |
| `src/typings/json-schema.ts`                                              | schema types                                      | 直接改 `@flowgram.ai/json-schema`                               |
| `src/typings/node.ts`                                                     | `IFlowValue`                                      | 本地冻结协议类型                                                |
| `src/nodes/{code,http,variable}/types.tsx`                                | flow/schema/assign types                          | direct schema + 本地协议类型                                    |
| `src/components/testrun/hooks/use-form-meta.ts`、`testrun-form/type.ts`   | schema types                                      | direct schema                                                   |
| `src/plugins/variable-panel-plugin/variable-panel-plugin.ts`              | schema type/utils                                 | direct schema                                                   |
| `src/plugins/variable-panel-plugin/components/global-variable-editor.tsx` | schema editor/utils                               | shadcn editor + direct schema utils                             |
| `src/plugins/variable-panel-plugin/components/full-variable-list.tsx`     | `useVariableTree`                                 | 纯 view-model hook + shadcn tree/command                        |
| `src/form-components/form-inputs/index.tsx`                               | dynamic value + prompt editors                    | 应用内 UI 重写                                                  |
| `src/form-components/form-item/index.tsx`                                 | schema tag                                        | shadcn renderer                                                 |
| `src/components/testrun/json-value-editor/index.tsx`                      | JSON code editor                                  | direct CodeMirror/editor core                                   |
| `src/components/testrun/testrun-form/index.tsx`                           | schema tag                                        | shadcn renderer                                                 |
| `src/nodes/code/components/{code,inputs,outputs}.tsx`                     | code editor、inputs、outputs、schema editor/types | direct editor + shadcn editors/renderers + direct/local types   |
| `src/nodes/code/form-meta.tsx`                                            | infer inputs plugin                               | 本地无头 plugin                                                 |
| `src/nodes/condition/condition-inputs/index.tsx`                          | condition row/type                                | shadcn editor + 本地协议类型                                    |
| `src/nodes/condition/form-meta.tsx`                                       | ref rename effect                                 | 本地无头 effect                                                 |
| `src/nodes/multi-condition/condition-inputs/index.tsx`                    | condition row/type                                | shadcn editor + 本地协议类型                                    |
| `src/nodes/multi-condition/form-meta.tsx`                                 | ref rename effect                                 | 本地无头 effect；同时检查当前 effect key 与 `branch.*` 数据路径 |
| `src/nodes/default-form-meta.tsx`                                         | validators/effects/display                        | 本地无头语义 + shadcn renderer                                  |
| `src/nodes/end/form-meta.tsx`                                             | inputs editor/display/infer plugin/types          | shadcn UI + 本地 plugin/types                                   |
| `src/nodes/http/components/{api,body,headers,params}.tsx`                 | prompt/JSON/inputs editors + flow types           | 应用内 UI + 本地协议类型                                        |
| `src/nodes/http/form-meta.tsx`                                            | infer inputs/display outputs                      | 本地 plugin + shadcn renderer                                   |
| `src/nodes/llm/form-meta.tsx`                                             | prompt/type/output effects                        | 应用内 prompt + 本地 type/effects                               |
| `src/nodes/loop/form-meta.tsx`                                            | batch editors/effect/plugin/types/display         | 最后迁移的复杂 shadcn UI + 本地 scope 语义                      |
| `src/nodes/start/form-meta.tsx`                                           | schema editor/display/effects                     | 通用 shadcn schema UI + 本地 effects                            |
| `src/nodes/variable/form-meta.tsx`                                        | assign editor/infer/display                       | shadcn editor + 本地 plugin/renderer                            |

该表覆盖基线上的全部 34 个生产 import；实现过程中应保持这个清单归零，而不是只统计根目录的 import 数。

## 推荐迁移顺序与验收门

### M1：冻结 wire contract

- 新增 `@flowgram.ai/json-schema@1.0.12` 直接依赖；
- 建立应用内 `workflow-value`、condition、assign 类型；
- 把所有 type-only imports 迁走；
- 对现有 fixture 做 parse → serialize deep equality。

**通过条件**：不修改任何 fixture byte shape；仍保留 form-materials runtime。

### M2：抽取 headless FlowGram 语义

- 迁入 effects、validators、infer plugins、Loop scope transform；
- 保持使用 FlowGram public editor/AST/scope API；
- 给每个行为写特征测试，测试目标是现有 package 1.0.12 的输出和事件结果，而不是重新解释需求。

**通过条件**：同一 workflow 经旧/新语义层 `toJSON()` deep equal；同一节点的 available/output variable key-path、schema 和 rename 后结果 deep equal。

### M3：先换 leaf renderer 和简单 editor

- `DisplaySchemaTag`、`DisplayOutputs`、`DisplayInputsValues`；
- JSON/TypeScript code editor 外壳；
- 基础 scalar constant editor。

**通过条件**：canvas、readonly/history、test-run 都从同一数据源展示；编辑前后 JSON 无无关字段变化。

### M4：迁移 variable-aware editors

- variable selector/tree；
- DynamicValueInput；
- prompt 与 JSON template editors；
- Condition/Assign/Inputs rows。

**通过条件**：变量插入、ref/template rename、unknown ref validation、key order 和 `extra.index` 都有自动化覆盖。

### M5：迁移 schema 与 Loop，再删除包

- 通用 JsonSchemaEditor；
- Start/Code/global variable；
- Loop private/public scope editors 和 plugins；
- 删除 `unstableSetCreateRoot`、form-materials dependency 和最后的 package import。

**通过条件**：下列“归零证明”全部通过。

## Semi 传递依赖归零的证明

完成标准必须同时覆盖 source、manifest、lockfile、resolved graph 和 build：

1. **生产源码**
   - `rg -n "@flowgram\\.ai/form-materials|@douyinfe/semi-(ui|icons)" src server`
   - 期望：0 条；测试/迁移说明中的文本引用另行排除，不可掩盖生产 import。
2. **直接依赖**
   - `package.json` 不再包含 `form-materials`、`semi-ui`、`semi-icons`。
3. **lockfile**
   - 重新执行 frozen-compatible `pnpm install` 后，`pnpm-lock.yaml` 不再出现这三个 package key。
4. **完整解析图**
   - `pnpm list --depth Infinity --json` 的 package name 集合不包含这三个名字；`pnpm why` 对三者均无路径。
   - 不能只看 direct dependencies，因为本票的核心目标就是消除传递边。
5. **可构建与行为回归**
   - `pnpm ts-check`、`pnpm lint`、`pnpm test`、`pnpm build`；
   - 加上 Workflow fixture round-trip、variable scope snapshot、rename、schema inference、Loop scope 和 structured-output contract tests。

如果未来某个 FlowGram package 又引入 Semi，第 4 步会失败；这正是应保留在 CI 的长期门禁。

## 上游策略

建议向 FlowGram 上游提出两个非阻塞改进：

1. 把 value types、validation、effects、form plugins 拆成不依赖 React/Semi 的 headless package；
2. 让 variable/schema/editor materials 通过 renderer adapter 或 slots 注入 UI，而不是在同一 package manifest 中硬依赖 Semi。

在上游提供稳定替代前，本仓库应维护最小的应用内语义层，不 fork 整个 `form-materials`，也不复制未使用能力。每段迁入代码保留 MIT 来源与固定版本说明，升级 FlowGram 时用特征测试比较行为。

## 来源索引

- 仓库基线：`origin/main@0a3c48754f9b9844b63493dcf2af4e71dbd76e36`；
- 精确分发物：本地安装的 `node_modules/@flowgram.ai/form-materials@1.0.12/package.json` 与 `src/`；
- 精确 schema 上游：本地安装的 `@flowgram.ai/json-schema@1.0.12` metadata/types；
- [FlowGram 官方源码仓库](https://github.com/bytedance/flowgram.ai)；
- [FlowGram 官方 form materials 介绍](https://github.com/bytedance/flowgram.ai/blob/main/apps/docs/src/en/materials/introduction.mdx)；
- [FlowGram 官方 `provideJsonSchemaOutputs` 文档](https://github.com/bytedance/flowgram.ai/blob/main/apps/docs/src/zh/materials/effects/provide-json-schema-outputs.mdx)；
- [FlowGram 官方 `JsonEditorWithVariables` 文档](https://github.com/bytedance/flowgram.ai/blob/main/apps/docs/src/en/materials/components/json-editor-with-variables.mdx)；
- [FlowGram 官方 Variable Selector / JSON Schema API](https://github.com/bytedance/flowgram.ai/blob/main/apps/docs/src/zh/materials/components/variable-selector.mdx)；
- [FlowGram 官方 `DisplayFlowValue` 依赖说明](https://github.com/bytedance/flowgram.ai/blob/main/apps/docs/src/zh/materials/components/display-flow-value.mdx)。
