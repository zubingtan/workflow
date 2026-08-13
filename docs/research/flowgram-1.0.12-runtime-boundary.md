# FlowGram 1.0.12：可复用的编辑器与运行时边界

> 研究日期：2026-08-13  
> 对应决策票：**核实 FlowGram 1.0.12 可复用的编辑器与运行时边界**  
> 结论只针对本仓库 lockfile 实际安装的 `1.0.12`，包含本仓库对
> `@flowgram.ai/runtime-js` 的补丁；不能外推到一个未固定版本的 FlowGram。

## 结论

FlowGram 1.0.12 值得继续作为 **workflow authoring framework**：它已经提供可注册节点、
free-layout 画布、可嵌套 `blocks`/`edges`、sub-canvas/container、端口连线、表单、编辑历史，
以及足够丰富的设计时变量 scope/type 系统。这些能力适合承载 Phase、Fan-out、Pipeline
等语义容器的**编辑和投影**。

它的 `runtime-js` 不应成为 dynamic/durable workflow 的调度语义真源。固定版本的 runtime
是进程内、一次性、静态 DAG 解释器：静态 sibling 使用 `Promise.all`，Loop 串行且 fail-fast，
node status 以 definition node ID 聚合，subcontext 只隔离 cache/variable/state，report 是当前内存
状态的整图快照，取消在上游原版中只改状态。本仓库补丁增加了 cooperative `AbortSignal` 和
自定义 executor 注册，但没有增加 durable queue、lease、attempt/item identity、重启恢复、
失败隔离或增量 journal。

因此推荐边界是：

| 层                                                                      | 复用判断                         | 说明                                                          |
| ----------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| Free-layout canvas、node registry、form/inspector、ports/lines、history | **直接复用**                     | 成熟的编辑框架职责                                            |
| Container/SubCanvas、nested `blocks`/`edges`                            | **直接复用为创作结构**           | containment 本身没有运行语义                                  |
| Variable engine 的 scope/type/selector                                  | **复用为设计时辅助**             | 不等于 `runtime-js` 的值与 scope 实现                         |
| Workflow schema、JSON Schema、Flow Value                                | **复用/编译输入**                | 需要编译到内部 IR，并补足明确的 control/data/containment 语义 |
| Custom node executor                                                    | **保留为 legacy/static adapter** | 本仓库靠补丁暴露；不是 durable scheduler extension point      |
| `TaskRunAPI` / `TaskReportAPI` / `TaskCancelAPI`                        | **仅 legacy/static island**      | 适合已有静态 workflow 或不需子级控制的 opaque subgraph        |
| Loop、静态 `Promise.all`、node status/report/context                    | **不可作为新调度内核**           | 无 dynamic fan-out、attempt、隔离、恢复和可重放事件           |

## 研究基线与方法

### 已确认事实

1. 根 `package.json` 将所有 FlowGram 产品依赖精确固定为 `1.0.12`，lockfile 的 resolved package
   也是 `1.0.12`，没有 caret/range 漂移。[package.json](../../package.json)、
   [pnpm-lock.yaml](../../pnpm-lock.yaml)
2. 上游 tag `v1.0.12` 指向 commit
   [`a9d1624a081d6b2a110dfe2f661c7efe4686a7b6`](https://github.com/bytedance/flowgram.ai/tree/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6)。
   本报告用该 commit 的 TypeScript 源码解释 npm 产物，并对本地安装包 sourcemap 的
   `sourcesContent` 做了抽样核对。
3. 本仓库通过 pnpm patch 修改 `runtime-js@1.0.12`：移除顶层“只能有一个 End”校验，加入共享
   `AbortController`/executor `signal`，并导出 `registerNodeExecutor()`。
   [仓库补丁](../../patches/@flowgram.ai__runtime-js@1.0.12.patch)
4. 研究时上游 `main` 为
   [`0d6131410e6f0fb114d067bb4699c57d906d611b`](https://github.com/bytedance/flowgram.ai/tree/0d6131410e6f0fb114d067bb4699c57d906d611b)。
   对 `packages/runtime`、`free-container-plugin`、`variable-core` 和 `variable-layout`
   做逐文件比较，未发现相对 `v1.0.12` 的源代码差异。因此本文没有用 current-main 行为替换
   pinned-version 结论；将来仍须按 lockfile 重新核查。

### 未知

- npm 发布流程没有在包 metadata 中写入 `gitHead`；tag 与 sourcemap 对得上，但不能仅凭
  `package.json` cryptographically 证明 tarball 来自该 commit。
- 本研究没有把 FlowGram 置于分布式、多进程或高基数负载下，因为 1.0.12 源码本身没有这些
  运行模型；性能上限不能从此报告推出。
- 上游未来是否会把 runtime 发展成稳定 SDK 未承诺。固定版本官方文档反而明确称其为 early
  development、API 不保证兼容、仅 Node.js/free-layout，定位为 reference demo 而非 SDK。
  [固定版本 Runtime Introduction](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/apps/docs/src/en/guide/runtime/introduction.mdx)

## 编辑器：可以复用的能力

### 1. 节点注册与 UI 扩展

**事实。** `FlowNodeRegistry` 可按 `type` 注册/继承节点，提供 meta、entity data、创建逻辑、
子节点创建、ports/lines/labels、布局、render 与 form 等扩展点；free-layout editor 也允许
自定义 node JSON 的序列化/反序列化。
[FlowNodeRegistry](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/canvas-engine/document/src/typings/flow-node-register.ts)、
[free-layout node serialization](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/client/free-layout-editor/src/preset/node-serialize.ts)

**建议。** Agent Task、Deterministic Task、External Action、Condition、Subworkflow 等叶节点
继续使用 registry/form/inspector 体系，不应另造一套画布框架。

### 2. Container 与 sub-canvas

**事实。** free-container-plugin 以 `meta.isContainer` 标记容器；`SubCanvasRender` 负责容器内
画布 UI。插件支持节点移入/移出、容器碰撞、历史事务和非法跨层连线清理。官方示例正是以
Loop container 展示这一用法。
[Sub-canvas 文档](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/apps/docs/src/en/guide/free-layout/sub-canvas.mdx)、
[container marker](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/plugins/free-container-plugin/src/utils/is-container.ts)、
[move into/out of container](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/plugins/free-container-plugin/src/node-into-container/service.ts)

**事实。** `WorkflowNodeJSON` 原生含递归 `blocks` 和每层自己的 `edges`；`WorkflowDocument`
递归 load/toJSON，使 nested definition 可以无损保存为编辑文档。
[WorkflowNodeJSON](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/canvas-engine/free-layout-core/src/typings/workflow-node.ts)、
[WorkflowDocument serialization](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/canvas-engine/free-layout-core/src/workflow-document.ts)

**推断。** 这些能力足以表达 Phase/Fan-out/Pipeline 的子画布 UX，但 `isContainer` 是编辑器
metadata；它没有自动赋予 phase lifecycle、fan-out expansion 或 pipeline scheduling。

**建议。** 区分：

- visual Group：纯布局；
- semantic Container：带 compiler-recognized type/policies/ports/exports；
- runtime ContainerExecution：运行期实体，不回写为 definition blocks。

### 3. Schema、ports 与 nested blocks

**事实。** runtime interface 的静态 schema 支持 nodes、edges、groups、global variable；node
支持 `data.inputsValues`、input/output JSON Schema、recursive blocks 和 child edges；edge 支持
可选 source/target port ID。Flow Value 声明了 constant/ref/expression/template。
[WorkflowSchema](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/interface/src/schema/workflow.ts)、
[WorkflowNodeSchema](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/interface/src/schema/node.ts)、
[edge schema](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/interface/src/schema/edge.ts)、
[Flow Value](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/interface/src/schema/value.ts)

**事实。** Runtime load 时把 nested blocks/edges flatten 到一个 document store，同时另外保存
parent/children；port 由 edge 的 port ID 建立，缺失时使用 `defaultInput/defaultOutput`。
[flat schema](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/document/document/flat-schema.ts)、
[document store](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/document/document/create-store.ts)

**推断。** FlowGram edge 在现有 runtime 中同时暗示 control order 和取值关系，却没有独立的
control dependency、data binding、containment、branch binding 类型。对简单静态图足够，
但内部 IR 应拆分这些语义，再 source-map 回 FlowGram ports/edges。

### 4. 设计时变量 scope

**事实。** FlowGram variable engine 将 scope 与 node 解耦：一个 node 可有 public/private
scope，global scope 可在节点外，Loop 等节点可有多层 scope；free-layout scope chain 能按
上游连接、父子关系和 private-child policy 计算依赖/覆盖关系，并允许自定义
`isNodeChildrenPrivate`。
[变量概念](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/apps/docs/src/en/guide/variable/concept.mdx)、
[custom scope chain](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/apps/docs/src/en/guide/variable/custom-scope-chain.mdx)、
[free-layout scope chain](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/variable-engine/variable-layout/src/chains/free-layout-scope-chain.ts)

**事实。** `runtime-js` 并不执行上述设计时 AST/scope engine。它使用另一套简单
`WorkflowRuntimeVariableStore`：以 `nodeID/key` 存 Map，substore 向 parent fallback；runtime
解析 constant/ref/template，但虽然 interface 声明 expression，`parseFlowValue()` 没有
expression 分支，会报 unknown type。
[runtime variable store](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/variable/variable-store/index.ts)、
[runtime state/value parser](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/state/index.ts)

**建议。** 复用 editor scope chain 做变量选择、可见性与类型诊断；compiler 把绑定降低到内部
IR。不要假设 editor 的 private/public/global scope 会被 `runtime-js` 自动忠实执行。

## Runtime：固定 1.0.12 的实际语义

### 1. Executor 与 extension point

**事实。** `INodeExecutor.execute()` 接收 node、inputs、runtime context、container、snapshot，
返回 outputs 与可选 branch；内部 `WorkflowRuntimeExecutor` 是 type→executor Map，支持 register。
[executor interface](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/interface/src/runtime/executor/node-executor.ts)、
[executor registry](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/executor/index.ts)

**事实。** 上游包入口没有公开 executor registry/container；本仓库 patch 才导出
`registerNodeExecutor()`，并用它注册 Agent/Feishu executor。
[仓库补丁](../../patches/@flowgram.ai__runtime-js@1.0.12.patch)、
[runtime adapter](../../server/runtime-adapter.mjs)

**建议。** 自定义 executor 可以继续承担“执行一个静态叶节点”或 legacy static subgraph，
但不要把 durable scheduler 隐藏进 executor。当前 extension point 不能替换 engine readiness、
execution identity、status/report 或持久化模型。

### 2. 静态 DAG concurrency 与 join

**事实。** 节点成功后，engine 取 next nodes 并用 `Promise.all` 调用；node 只有在所有 prev node
都进入 `executedNodes` 后才执行。Condition 返回 branch 时，engine 将未选路径的 unique nodes
直接标记为 executed，以允许后续 join。
[engine](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/engine/index.ts)

**事实。** 一个 executor 抛错会把该 node 标失败并向上抛；workflow 的顶层 `process()` 捕获后
标记 workflow failed 并返回 `{}`。`Promise.all` 不会取消已启动 sibling，因此 fail-fast 是
“父 promise 尽快失败”，不是可靠的 sibling cancellation。

**建议。** 可保留此语义处理小型静态、无 durable child control 的图；不能把它当作
Fan-out/Join scheduler。尤其不能由 `Promise.all` 推导 item isolation、并发限流、attempt、
retry 或 crash recovery。

### 3. Loop

**事实。** Loop 解析完整 array 后用普通 `for` 逐项运行；每项创建 subcontext，写入
`{loopId}_locals.item/index`，`await` 完成 block 后才进入下一项。任一 block 异常转换为
`Loop block execute error` 并终止整个 Loop；没有 per-item concurrency 或 failure isolation。
[Loop executor](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/nodes/loop/index.ts)

**事实。** 所有迭代复用相同 definition node ID 的 status，snapshots 则按 node ID 追加多个。
所以 report 能看到多次 snapshot，但没有稳定 item execution/attempt identity。
[status center](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/status/status-center/index.ts)、
[snapshot center](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/snapshot/snapshot-center/index.ts)

**建议。** 不复用 Loop 表示 Router→N dimensions 的 dynamic fan-out。可以复用其画布外观和
body-template authoring，但运行时必须由新 scheduler 创建 item executions。

### 4. Context 与隔离边界

**事实。** `context.sub()` 新建 cache、variable store、state；variable store 的 parent 指向
父 context。但 document、IO center、snapshot center、status center、message center、reporter
全部共享。本仓库 patch 又让 root/subcontext 共享同一 AbortController。
[context](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/context/index.ts)、
[仓库补丁](../../patches/@flowgram.ai__runtime-js@1.0.12.patch)

**推断。** subcontext 是 Loop lexical values 的轻量隔离，而不是 task/item/attempt 的运行隔离；
它无法提供 item 独立取消、独立 status、lease、worker ownership 或 durable recovery。

### 5. Report 与事件

**事实。** `TaskReportAPI` 从内存 task context 即时 export 一个 `IReport`：workflow IO/status、
以 node ID 为 key 的 status+snapshots，以及按级别分组的 messages。每次 export 生成新 report
ID；不存在 monotonic event ID、cursor、append-only journal 或 artifact reference。
[report interface](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/interface/src/runtime/reporter/index.ts)、
[reporter](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/report/reporter/index.ts)、
[application task map](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/application/workflow.ts)

**事实。** `WorkflowApplication.tasks` 是进程内 Map；源码没有持久化、lease、heartbeat、requeue
或启动恢复。

**建议。** `IReport` 只作为 legacy adapter 的投影。新 runtime 需要 append-only journal、
durable executions/attempts 和由 journal/state 构建的 read projection；不要把高基数 transcript
塞进 `IReport`。

### 6. Cancellation

**事实。** 原版 1.0.12 的 `task.cancel()` 只把 workflow 和 processing node statuses 改成 canceled；
executor interface 没有 AbortSignal，因此无法中断进行中的 I/O。
[upstream task cancel](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/task/index.ts)、
[upstream execution context](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/interface/src/runtime/executor/node-executor.ts)

**事实。** 本仓库 patch 在 cancel 时 abort 共享 controller，把 `signal` 传给 executor；Agent
executor 将它桥接到 pi session abort。这是 cooperative cancellation：忽略 signal 的 executor
仍不会被强制停止。
[仓库补丁](../../patches/@flowgram.ai__runtime-js@1.0.12.patch)、
[Agent signal bridge](../../server/runtime-adapter.mjs)

**建议。** 保留此 signal 作为 worker-adapter 最底层的取消机制；durable scheduler 仍须先写
`cancellation_requested`，停止派发新任务，追踪每个 attempt 的实际 terminal/lost 状态，并处理
force timeout。

### 7. 本仓库多 End 补丁的额外风险

**事实。** 上游 validator 要求顶层恰好一个 Start/End，并递归要求每个 block 恰好一个
block-start/block-end；本仓库只移除了“最多一个顶层 End”的检查。
[upstream validator](https://github.com/bytedance/flowgram.ai/blob/a9d1624a081d6b2a110dfe2f661c7efe4686a7b6/packages/runtime/js-core/src/domain/validation/validators/start-end-node.ts)、
[仓库补丁](../../patches/@flowgram.ai__runtime-js@1.0.12.patch)

**推断。** 多个 End executor 都可写同一个 shared IO center，最终 outputs 取决于到达顺序；
patch 只放宽 validation，没有定义 multi-end join/output arbitration。因此不能把“能保存/运行多个
End”当作已经拥有清晰的多终点语义。

## 对目标架构的明确边界

### 可以直接建立在 FlowGram 之上的部分

1. Phase/Fan-out/Pipeline/Composite 的 sub-canvas 与 nested definition；
2. semantic leaf/container 的 node registry、forms、inspector、ports 和 diagnostics；
3. 设计时 lexical visibility、variable selector、JSON/AST type assistance；
4. Workflow Document 的布局、编辑历史和 compiler source map；
5. 旧静态 workflow 的展示与 legacy `TaskRunAPI` 执行。

### 必须由内部 IR/compiler 明确定义的部分

1. control dependency、data binding、branch 与 containment 的分离；
2. container inputs/exports 和 item lexical scope；
3. Phase/Fan-out/Pipeline 的 executable semantics；
4. stable semantic node ID 与 immutable definition version；
5. FlowGram node/port/container ↔ IR element 的 source map；
6. unsupported editor/runtime feature 的 compile diagnostics（尤其 expression 与动态容器）。

### 必须由 durable scheduler/runtime 新增的部分

1. dynamic expansion 与 stable item key/path；
2. TaskExecution/TaskAttempt identity；
3. retry/skip/failure isolation/fallback；
4. hierarchical concurrency/budget；
5. durable ready queue、lease、heartbeat、lost/reconcile/restart recovery；
6. cancellation tree；
7. append-only journal、artifact lineage、cursor-based events；
8. subworkflow version binding 与 external-action idempotency。

## 最小决策建议

### 建议

1. **FlowGram Document 是 authoring/layout projection，不是执行语义真源。**
2. **Canonical IR 是 editor 与 scheduler 的合同。** FlowGram schema 可作为 compiler input，
   但不能把现有 edge/context/status 隐式行为原样升级成产品合同。
3. **Container UI 与 runtime execution 分离。** Definition 中保留一个 body template；N 个 item
   只存在于 run execution tree。
4. **`TaskRunAPI` 降级为 legacy/static adapter。** 只有不要求内部 retry/skip/attempt/recovery
   的静态 island 才交给它。
5. **保留 executor patch 但冻结用途。** 它适合 leaf adapter 和迁移期兼容，不继续扩充为隐藏调度器。
6. **为 FlowGram 版本升级建立 conformance tests。** 至少覆盖 nested blocks serialization、
   port mapping、scope visibility、branch/join、Loop、report 和 cancel signal；升级时以 lockfile +
   patch hash 为准，而不是以 current docs 为准。

### 仍需后续决策/验证

- semantic container 在 editor 中的具体 port/export UX；
- IR 的 control/data/containment algebra；
- legacy static island 的最大边界，以及其内部是否允许不可控 Agent；
- 多 End 是改回单 End + explicit merge，还是给 compiler 定义输出仲裁；
- 高基数 runtime overlay 如何映射回一个 definition node，而不污染 definition document。

这些问题不改变本票结论：**最大化复用 FlowGram 的编辑器与类型辅助，最小化依赖其 reference
runtime 的调度语义。**
