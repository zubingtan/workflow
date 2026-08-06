# 最新 main 的 UI surface 与 Semi/form-materials 耦合边界

> Wayfinder research ticket: [#259](https://github.com/zubingtan/workflow/issues/259)
> 基线：`origin/main@0a3c48754f9b9844b63493dcf2af4e71dbd76e36`
> Prototype 参考：`research/shadcn-ui-prototype@da7203e64`（仅作为视觉与交互参考，不是生产契约）

## 结论

1. **FlowGram 编辑器引擎可以保留，应用拥有的 UI 可以完整重做。** `useEditorProps` 明确注册了应用自己的 `BaseNode`、Comment renderer、选择框、工具栏和面板；拖拽、端口、连线、缩放、history、variable engine、runtime 等仍由 FlowGram 引擎负责。[`src/hooks/use-editor-props.tsx:200-255`](../../src/hooks/use-editor-props.tsx#L200-L255)
2. **Semi 依赖清零不能只替换业务组件。** 最新 main 上直接导入 `@douyinfe/semi-ui` / `@douyinfe/semi-icons` / `@flowgram.ai/form-materials` 的 TypeScript 文件分别为 **68 / 29 / 34**。更关键的是 `@flowgram.ai/form-materials@1.0.12` 的 lockfile dependency block 仍直接包含 Semi UI 与 Semi Icons；只要包还在依赖树里，“彻底清零”就没有完成。[`package.json:19-47`](../../package.json#L19-L47) [`pnpm-lock.yaml:8354-8368`](../../pnpm-lock.yaml#L8354-L8368)
3. **迁移边界应拆成三层。** （A）应用自有界面直接用 shadcn 重组；（B）form-materials 的可视组件用应用自有实现替换；（C）其中纯 effect、validation、schema/type、variable plugin 语义抽取到本地或改用更低层 FlowGram 包。最终移除整个 form-materials 包，不能长期保留“只用它的非视觉函数”的过渡状态。
4. **prototype 不能覆盖生产契约。** 最新 main 已加入完整 Provider 握手、Structured Output、mem0、History SSE 生命周期与 Test Run queue 行为；prototype 对这些能力主要是交互草图。视觉可参照 prototype，数据形状、API、保存与执行语义必须以 main 为准。
5. **现有 token 基础需要“反转依赖”，不应删除后从零开始。** `theme-controller` 的 `light | dark | auto`、FOUC 和 `body[theme-mode]` 可保留；但 `--app-color-*` 目前反向引用 Semi `--semi-color-*`，迁移时应改为应用/shadcn 自己的颜色基座，再继续通过 `flowgram-bridge.css` 驱动画布、端口和连线。[`src/theme/tokens.css:67-120`](../../src/theme/tokens.css#L67-L120) [`src/theme/use-theme.ts:30-106`](../../src/theme/use-theme.ts#L30-L106)

## 调查方法与计数口径

- 基于上述 commit 扫描 `src/**/*.{ts,tsx}` 的静态 import declaration；同一文件多次 import 只计一次。
- 结果：Semi UI 68 个文件，Semi Icons 29 个文件，form-materials 34 个文件。lockfile 当前实际解析到 Semi `2.101.1` 与 form-materials `1.0.12`。[`pnpm-lock.yaml:1314-1330`](../../pnpm-lock.yaml#L1314-L1330) [`pnpm-lock.yaml:1796`](../../pnpm-lock.yaml#L1796)
- 旧 map 中的 66/28 是早于本次 main 更新的快照，应由本研究结果取代。
- “UI surface”按用户可到达的页面、浮层、节点卡片/表单以及支撑这些界面的状态/API 契约归类，不把每个小图标列成单独 surface。

## Surface inventory

| Surface                                                                     | owning files                                                                                                            | 现有 Semi primitives                                                                              | FlowGram / form-materials 边界                                                                                     | 必须保留的 state / API contract                                                                                                     | Prototype reference                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| App shell、导航、theme、editor header                                       | `src/app.tsx`; `src/theme/*`                                                                                            | `Button`, `Typography`, `Spin`, `Toast`, `Modal`, `Input`, `LocaleProvider`；Semi icons；Semi CSS | `unstableSetCreateRoot` 是 app bootstrap 对 form-materials 的小耦合；编辑器 context 和 document JSON 来自 FlowGram | hash route；未保存导航确认；inline rename；`ctx.document.toJSON()` 保存；`direction` 与 `globalVariable` 必须原样落回 Workflow JSON | `WorkbenchRail`, `WorkbenchHeader`                                             |
| Workflows catalog                                                           | `src/manage.tsx`; `src/api.ts`; `src/use-active-run-counts.ts`                                                          | `Table`, `Modal`, `Input`, `Button`, `Popconfirm`, `Tooltip`, `Toast`, typography/space/icons     | 无 form-materials；仅打开 editor 与 History                                                                        | CRUD `/workflows`; copy；active-run SSE gate；409 `workflow_has_active_runs` 是后端真相                                             | `WorkflowsPage`；统一列表与操作布局可复用                                      |
| Agents catalog + editor shell                                               | `src/components/agent-miller/index.tsx`; `use-hash-route.ts`; `agent-config-store.mjs`                                  | `ResizeGroup`, `List`, `Tabs`, `Button`, `Input`, `Tag`, `Dropdown`, `Modal`, `Toast` 等          | 无 FlowGram；纯 React 管理界面                                                                                     | `#/agents/:id/:section`；600ms per-agent debounce、deep merge、串行保存、retry；Provider 是显式 test/save 例外                      | `AgentsPage`, `AgentSection`；列表进入详情、侧栏分区                           |
| Agent Basic / Provider / Prompt / Runtime / Tools                           | `src/components/agent-miller/sections/*`                                                                                | `Input`, `TextArea`, `Select`, `Switch`, `Tag`, `Button`, `Collapse`, typography                  | 无 FlowGram/form-materials                                                                                         | Agent config JSON 的 provider/system_prompt/session_options/pi_settings 形状；各 section patch 交给 coordinator                     | prototype 对应 section 仅可参考层级与密度                                      |
| Agent Skills / Extensions / Memories / Sessions / Statistics                | 同上；`session-detail.tsx`                                                                                              | `Upload`, `List`, `Switch`, `Table`, `Modal`, `Empty`, `Spin`, `Tag`                              | 无 FlowGram/form-materials                                                                                         | skills/extensions 即时 patch；mem0 proxy；session 列表与详情；statistics API                                                        | prototype 有 skill folder import、session/chat 草图；生产 API 优先             |
| Settings / mem0                                                             | `src/components/admin-settings/index.tsx`; `src/api.ts`; `server/settings.mjs`; `server/mem0-proxy.mjs`                 | `Input`, `InputNumber`, `Button`, `Spin`, `Toast`, `Tag`, typography/icons                        | 无 FlowGram/form-materials                                                                                         | GET/PUT `/api/settings`; POST `/api/mem0/test`, `/configure`;现有 main 仍为显式 Save/Test                                           | `SettingsPage`, `SettingsCard`；sidebar/autosave/model select 只是未来设计参考 |
| Editor canvas + app-owned chrome                                            | `src/editor.tsx`; `src/hooks/use-editor-props.tsx`; `src/components/tools/*`; `src/components/sidebar/*`; panel plugins | 工具栏、Popover、Modal、Button、Tooltip、Toast、Icons                                             | **保留 FlowGram engine**；应用注册渲染器、tools、panels；sidebar renderer 为应用自有圆角容器                       | drag/select/ports/lines/undo/redo/document state；panel-manager 的开关与尺寸；history readonly 规则                                 | `EditorCanvas`, `CanvasToolbar`, floating header/zoom controls                 |
| Node card shell                                                             | `src/components/base-node/*`; node registry/form renderers                                                              | `ConfigProvider` 只用于 popup container；error icon 来自 Semi                                     | `BaseNode` / `NodeWrapper` 完全应用自有；`form?.render()` 来自 node registry；FlowGram 负责 geometry 与 selection  | 卡片内表单与 NodeStatusBar 不得改变 document schema；popup container 需换成 shadcn portal 策略                                      | `NodeCard`                                                                     |
| Node forms: Start/End/LLM/HTTP/Code/Condition/Loop/Variable/Global variable | `src/nodes/**`; `src/form-components/**`; variable-panel plugin                                                         | 外层大量 Semi input/select/button/tag；内层见下文 form-materials matrix                           | form-materials 同时提供可视 editor 和 effects/plugins/types；这是依赖清零的最后硬边界                              | `data.inputs` / `data.outputs` / FlowValue / JsonSchema；variable references；port schema；validation/effect 时序                   | `Inspector`, `VariableBinding`, `NodeLibrary` 只参考信息架构                   |
| Structured Output                                                           | `src/nodes/llm/structured-output-editor.tsx`; `schema-state.mjs`; `form-meta.tsx`; server structured-output/runtime     | 编辑器为应用自有 Semi `Button/Input/Select/Tag/Typography`                                        | `provideJsonSchemaOutputs` 仍从 form-materials；其余状态与后端校验为应用自有                                       | `data.outputs` 保持 FlowGram `IJsonSchema`; flat field 校验；provider response format；validated projection only                    | Inspector 的 Simple/JSON 切换是草图；main 当前只有 flat simple editor          |
| History list + readonly viewer                                              | `src/components/history-modal/*`; `runs-table.tsx`; `readonly-viewer/*`; runtime services                               | `Modal`, `Table`, `Tag`, `Button`, `Popconfirm`, `Tooltip`, `Toast`, `Empty`, `Spin`              | readonly viewer 重用同一 FlowGram editor/materials；live/static runtime service 不可替换成 mock                    | run list/detail/cancel/delete；单 SSE owner；terminal 使用 `schema_snapshot + report` 且不可修改                                    | header `History`/Sheet 仅参考入口和视觉                                        |
| Test Run                                                                    | `src/components/testrun/**`; runtime plugin; panel manager                                                              | `Button`, `Input`, `Switch`, `InputNumber`, `Tag`, `Select`, `Modal`, `Toast`                     | `DisplaySchemaTag`, `JsonCodeEditor` 来自 form-materials；运行状态来自 FlowGram runtime plugin                     | node forms validate 后才打开；JSON/schema input mode；queue position；cancel；results/errors；localStorage input mode               | `ExecutionDock` 仅视觉草图                                                     |

## 关键生产契约

### Workflow 与 App shell

Workflow API 当前为 list/get/create/update/delete/copy；create 接收 `{ name, data }`，update 持久化完整 workflow JSON。[`src/api.ts:142-179`](../../src/api.ts#L142-L179) 进入 editor 后，dirty tracking 由 FlowGram document change 驱动，保存必须包含 `ctx.document.toJSON()`、`direction` 和 `globalVariable`。[`src/app.tsx:55-77`](../../src/app.tsx#L55-L77) [`src/hooks/use-editor-props.tsx:257-267`](../../src/hooks/use-editor-props.tsx#L257-L267)

当前生产 Workflows catalog **没有** import/export API；Agents 则已有。prototype 中统一的 Workflow import/export 只能作为产品意图，迁移 UI 时不能伪造已经存在的后端契约。

### Agent autosave 与 Provider

通用 Agent section 的保存语义不在组件按钮上，而在 React-free `AgentSaveCoordinator`：patch 深合并、默认 600ms debounce、每个 Agent 串行 flush、失败保留 pending 并允许 retry。[`src/components/agent-miller/agent-config-store.mjs:1-56`](../../src/components/agent-miller/agent-config-store.mjs#L1-L56) [`src/components/agent-miller/agent-config-store.mjs:93-163`](../../src/components/agent-miller/agent-config-store.mjs#L93-L163) UI 替换应复用这条 seam，不能把所有 section 恢复为全局 Save bar。

Provider 是例外，因为它需要可验证的握手状态：

1. POST `/agents/:id/provider/models` 发现模型并返回 `model_list_token`；
2. POST `/agents/:id/provider/test` 使用 provider + model token 测试，返回 `test_token`；
3. PUT `/agents/:id/provider` 使用 test token 持久化。

编辑 endpoint/key 必须清空 model list、model token 和 test token；仅编辑 model 也必须使 test token 失效。当前状态机为 `idle → loading-models → models-loaded → testing → tested → saving/error`。[`src/components/agent-miller/sections/provider-section.tsx:1-18`](../../src/components/agent-miller/sections/provider-section.tsx#L1-L18) [`src/components/agent-miller/sections/provider-section.tsx:100-205`](../../src/components/agent-miller/sections/provider-section.tsx#L100-L205) [`server/app.mjs:380-470`](../../server/app.mjs#L380-L470)

Agent import/export 已有后端与前端流程：export all 与 individual export API 均存在；当前 UI 只暴露 export all。Import 读取 JSON 后先 `/agents/import` precheck，再在冲突 modal 选择 skip/overwrite/rename，最后 `/agents/import/confirm`。[`src/api.ts:264-286`](../../src/api.ts#L264-L286) shadcn 迁移可完善 selection UI，但不能跳过冲突确认语义。

### Structured Output

Structured Output 的持久化格式没有引入第二套 JSON：编辑器只把 flat field list 编解码为 node `data.outputs` 中的 FlowGram `IJsonSchema`。[`src/nodes/llm/schema-state.mjs:1-10`](../../src/nodes/llm/schema-state.mjs#L1-L10) 当前支持 `string | integer | number | boolean`，拒绝空 key、重复 key、点号、控制字符和 prototype-pollution key。[`src/nodes/llm/schema-state.mjs:13-34`](../../src/nodes/llm/schema-state.mjs#L13-L34) [`src/nodes/llm/schema-state.mjs:77-120`](../../src/nodes/llm/schema-state.mjs#L77-L120)

后端把声明 schema 转成 provider 的 structured response format，校验模型输出，并只投影已声明字段；失败返回 `structured_output_error`。[`server/structured-output.mjs:99-191`](../../server/structured-output.mjs#L99-L191) [`server/runtime-adapter.mjs:330-342`](../../server/runtime-adapter.mjs#L330-L342) [`server/agent-execution.mjs:273-322`](../../server/agent-execution.mjs#L273-L322) prototype 里的高级 JSON Schema 模式尚未存在于 main，不能在纯 UI 迁移中顺带实现。

### Settings 与 mem0

当前 settings 字段为 node timeout、mem0 host/key/admin key、LLM base URL/model、embedding model/dimensions；后端 GET/PUT `/api/settings`，mem0 通过同源 proxy 提供 status/memories/test/configure。[`server/app.mjs:733-818`](../../server/app.mjs#L733-L818) 当前 main 仍允许手填 LLM/embedding model，也没有供 mem0 settings 使用的 model discovery API。prototype 的自动抓取与下拉框是待实现产品行为，不是本次 UI 迁移可假定的既有能力。

### History

History 不是普通 modal 换皮：workflow catalog、History modal、readonly viewer 会协调 `/api/workflows/:id/runs/events` 的唯一 EventSource owner，避免浏览器连接上限；queued/running viewer 用 current workflow + live runtime，terminal viewer 用不可变 `schema_snapshot + report` + static runtime。[`server/app.mjs:1028-1050`](../../server/app.mjs#L1028-L1050) [`src/components/readonly-viewer/index.tsx:1-35`](../../src/components/readonly-viewer/index.tsx#L1-L35)

保留动作契约：run list、detail、active cancel、terminal delete；后端拒绝删除 queued/running run。[`src/api.ts:366-372`](../../src/api.ts#L366-L372) [`server/app.mjs:1143-1180`](../../server/app.mjs#L1143-L1180) UI 可以改为 shadcn Sheet/Dialog/Table，但 SSE 生命周期与 readonly runtime 不得重写。

### Test Run

Test Run 入口先验证所有 node form，invalid 时不启动；panel 支持 schema form / raw JSON input、queue position、cancel、inputs/outputs/errors，并保存 JSON mode 到 localStorage。已保存 workflow 走后端 queue，draft workflow 仍允许即时 runtime。迁移应替换 panel chrome 与 form-materials JSON/schema widgets，保留 runtime plugin 与 queue contract。

## form-materials replacement matrix

| 生产用途                                        | 当前导入                                                                                                                                 | 清零动作                                                                      | 必须保持的语义                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 通用 prompt / dynamic value                     | `PromptEditorWithVariables`, `DynamicValueInput`                                                                                         | 用应用自有 shadcn editor + variable popover 替换                              | FlowValue/template 字符串、变量引用插入与 schema 提示                    |
| Start / global variables / Code outputs         | `JsonSchemaEditor`, `JsonSchemaUtils`                                                                                                    | 本地 schema editor；必要的 schema utils 抽取或改用 `@flowgram.ai/json-schema` | 原 `IJsonSchema` JSON 形状与 variable engine 声明                        |
| End / HTTP / Code inputs                        | `InputsValues`, `DisplayInputsValues`                                                                                                    | shadcn key/value rows + readonly display                                      | input inference、FlowValue、上游变量选择                                 |
| Default / HTTP / Code / Loop / Variable outputs | `DisplayOutputs`                                                                                                                         | 应用自有 outputs list                                                         | 只改 renderer，不改 declared outputs                                     |
| Condition / multi-condition                     | `ConditionRow`                                                                                                                           | 应用自有 condition builder                                                    | 运算符、左右值、branch/port 绑定                                         |
| Loop                                            | `BatchVariableSelector`, `BatchOutputs`                                                                                                  | 应用自有 selector/output rows                                                 | batch variable 与迭代输出结构                                            |
| Variable                                        | `AssignRows`                                                                                                                             | 应用自有 assignment rows                                                      | assign 类型推断与 variable references                                    |
| Code                                            | `TypeScriptCodeEditor`                                                                                                                   | 本地 CodeMirror/shadcn shell                                                  | TypeScript 文本、validation、尺寸与 readonly                             |
| HTTP body / Test Run JSON                       | `JsonEditorWithVariables`, `JsonCodeEditor`, `DisplaySchemaTag`                                                                          | 本地 JSON editor/tag                                                          | JSON 值、变量 token、schema-mode 切换                                    |
| effects / validators / form plugins             | `autoRenameRefEffect`, `provideJsonSchemaOutputs`, `syncVariableTitle`, `createInferInputsPlugin`, `createInferAssignPlugin`, validators | 抽取到 app-owned 非视觉模块，或替换为低层 FlowGram API                        | rename refs、schema propagation、input/assign inference、validation 时序 |
| types/bootstrap                                 | `IJsonSchema`, `IFlowValue`, `JsonSchemaBasicType`, `unstableSetCreateRoot`                                                              | 迁到本地 typings / 低层包；移除 bootstrap hook                                | TypeScript 形状保持，不增加第二套 runtime 格式                           |

完整的 34 个直接导入分布在 `src/app.tsx`、`src/form-components/**`、`src/nodes/**`、Test Run 和 variable-panel plugin；其中视觉与非视觉职责混在同一个 package export surface 中。即使改成该包的 component/effect/validator 深路径，lockfile 仍会保留整包及其 Semi dependencies。[`pnpm-lock.yaml:8354-8368`](../../pnpm-lock.yaml#L8354-L8368) 因此最终态必须把上述需要的非视觉能力迁出后删除 package，而不是留下深路径 import。

## FlowGram 保留边界

**保留：** `FreeLayoutEditorProvider` / renderer、document/entity/form/runtime/variable engines、drag/selection/ports/lines、stack/snap/group/container、history、panel manager、minimap、download/export plugin。它们定义 workflow editor 的执行与编辑语义。

**重做：** App shell、catalog、settings、Agent editor、editor floating controls、node card shell、node sidebar shell、history/test-run chrome、所有 node form controls。`BaseNode` 已是应用自有容器，只需要移除 Semi `ConfigProvider` 与 icon；其中 popup container 行为需用 shadcn/Radix portal 明确承接。[`src/components/base-node/index.tsx:7-35`](../../src/components/base-node/index.tsx#L7-L35) [`src/components/base-node/styles.tsx:7-37`](../../src/components/base-node/styles.tsx#L7-L37)

**桥接：** `flowgram-bridge.css` 可保留职责，用新的 app/shadcn token 驱动画布、端口、线和 minimap。现有 ADR 明确该 bridge 通过 FlowGram 公共 CSS/API 更新主题而不 remount editor，从而避免丢失 undo/redo、scroll 与 selection。[`docs/adr/0002-design-token-system.md:79-88`](../adr/0002-design-token-system.md#L79-L88)

## Prototype 对照与不可直接迁移项

Prototype 可作为以下 interaction target：浮动圆角侧栏、catalog list → detail 的 push transition、Agents/Workflows 统一 list row、agent section sidebar、floating editor header/toolbar/zoom、rounded node inspector、History 入口、Structured Output 信息架构。

但以下 prototype 行为不是生产契约：

- Workflow import/export selection（main 尚无 API）；
- mem0 model 自动发现（main 尚无 API）；
- Structured Output 高级 JSON mode（main 尚无 editor/runtime contract）；
- mock session/chat、mock provider test、mock run/history 数据；
- 任何 client-only JSON 下载如果绕过生产冲突处理、secret redaction 或 backend validation。

实现迁移时，应逐 surface 复刻 prototype 的视觉与层级，同时调用 main 已有 store/API/runtime；不应把整份 prototype component tree 覆盖到 production。

## 对迁移切片的约束性建议

1. **先反转 token 与基础 shadcn primitive。** 保留 theme controller/FOUC/FlowGram bridge，移除 token 对 Semi CSS vars 的依赖。
2. **先迁移纯管理 surface。** Shell → Workflows/Agents catalog → Agent sections → Settings；这些不依赖 FlowGram form-materials，能快速建立统一列表、sidebar、modal/sheet、autosave feedback。
3. **再迁移 editor app chrome。** Floating header/tools/zoom、History、Test Run panel shell、node card/sidebar shell；保留 FlowGram provider/plugins/runtime。
4. **最后逐类替换 form-materials。** 优先 prompt/variables、schema、condition、assign/batch、code/JSON editors，同时以原 Workflow JSON fixture 做 round-trip 回归。
5. **依赖树清零作为最终 gate。** 直接 import 归零不够；必须从 `package.json` / lockfile 删除 `@flowgram.ai/form-materials`、Semi UI、Semi Icons，并验证没有 transitive Semi。FlowGram editor packages 本身可继续保留。

## 验收线

- 所有既有 Workflow JSON 可无损加载、编辑、保存、再次执行；`direction`、`globalVariable`、node `data.inputs/outputs` 不漂移。
- Agents CRUD/import/export、autosave coordinator、Provider staged handshake、sessions/memories/statistics 保持 API 与状态语义。
- History 的 SSE owner、cancel/delete、live/static readonly viewer 不回退。
- Test Run 的 validation、queue/cancel、JSON/schema inputs 与 results 不回退。
- Structured Output 仍只投影 schema 声明字段，非法 schema/响应仍以相同错误类别终止。
- FlowGram drag/ports/lines/undo/redo/minimap/runtime 保持；节点卡片和表单视觉全部由应用控制。
- `src/` 中 Semi UI/Semi Icons/form-materials imports 为 0，依赖树与 lockfile 中 Semi UI/Semi Icons/form-materials 为 0。
