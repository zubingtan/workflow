# pi 0.81 的 Task Attempt 生命周期与隔离边界

> 研究基线：2026-08-13。结论面向 `zubingtan/workflow` 当前 `main`（`24974b0e1d772044a2ccf37020815ca573fa70ff`）实际安装的 pi 版本，而不是滚动的上游 `main`。

## 结论摘要

本仓库 lockfile 实际解析到 `@earendil-works/pi-agent-core`、`pi-ai`、`pi-coding-agent` **0.81.0**；`pi-coding-agent` 的锁定 tarball integrity 为 `sha512-2p0D...`。上游 `v0.81.0` tag 指向 commit `9c480b6ad2c7419875a7a850fb4ad5f9232313b8`。本报告以 lockfile 安装包核对公开 tag 源码与同包 SDK 文档。[本仓库 lockfile](https://github.com/zubingtan/workflow/blob/24974b0e1d772044a2ccf37020815ca573fa70ff/pnpm-lock.yaml#L1424-L1436) [pi v0.81.0](https://github.com/earendil-works/pi/tree/9c480b6ad2c7419875a7a850fb4ad5f9232313b8)

**最终判断：pi 0.81 可以可靠承担一次 Task Attempt 内的 agent reasoning loop，但不能成为 Task Attempt 的 durable 状态机。**

可直接复用的 attempt 内能力是：新建一个隔离的 `AgentSession`、模型调用与 tool loop、消息/turn/tool 事件、会话 JSONL、compaction、attempt 内 transient retry、协作式 abort，以及 tools/skills/extensions 的装配。必须留在外层 workflow runtime 的能力是：attempt ID 与状态机、lease/heartbeat、并发与预算、workflow retry/fallback、崩溃后的 `lost`/reconcile、外部副作用幂等、安全 sandbox、artifact lineage 和跨 attempt 调度。

推荐合同是：

```text
TaskExecution
  └─ TaskAttempt (outer runtime owns durable identity/status/policy)
       └─ one fresh pi AgentSession
            ├─ one persistent JSONL transcript
            ├─ zero or more LLM turns/tool calls
            ├─ pi-local provider/agent retries
            └─ optional pi-local compactions
```

`AgentSession.sessionId` 不能代替 `TaskAttempt.id`。Retry 创建新 `TaskAttempt` 和新 pi session；pi 自己的 provider/agent retry、structured-output repair 与 compaction 都只是同一 attempt 内部活动。

---

## 1. 已确认事实

### 1.1 创建、持久化、open/continue/fork/import

| 能力            | pi 0.81 的事实                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 对 Task Attempt 的含义                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 创建            | `createAgentSession()` 创建一个 `AgentSession`；默认使用 persistent `SessionManager.create(cwd)`，也可注入 `SessionManager.inMemory()`。[SDK](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/sdk.md#quick-start) [factory](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/sdk.ts#L164-L184)                                                                                                                                                   | 外层可为每个 attempt 显式创建全新 session，并选择是否保存 transcript。                               |
| 持久化格式      | Session 是带 header 的 JSONL append-only tree；entry 用 `id/parentId` 形成分支，包含 messages、model/thinking changes、compaction、custom entries 等。[格式](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/session-format.md#file-format) [实现](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/session-manager.ts#L855-L1049)                                                                                                               | 适合保存 attempt transcript/context；不是 workflow event store。                                     |
| 写入边界        | `AgentSession` 在 `message_end` 才调用 `SessionManager.appendMessage()`；token delta、tool start 等事件不写入 session。新 session 在出现第一个 assistant message 前还可能没有真正 flush 到文件；第一个 assistant message 到来时才把积累 entries 写出。[事件持久化](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session.ts#L596-L648) [lazy flush](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/session-manager.ts#L1015-L1049) | 不能把“已接受 prompt”“provider request 已开始”或“tool side effect 已发生”从 JSONL 是否存在推导出来。 |
| Open            | `SessionManager.open(path)` 读取 header、恢复 cwd、迁移版本并重建索引/active leaf；`createAgentSession()` 从 active context 恢复 messages、model 和 thinking level。[open](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/session-manager.ts#L1523-L1549) [restore](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/sdk.ts#L182-L238)                                                                                                      | 能恢复已持久化的历史上下文，但不表示恢复一个正在执行的 attempt。                                     |
| Continue recent | `continueRecent(cwd)` 选择最近 session，找不到则创建新 session。[实现](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/session-manager.ts#L1551-L1565)                                                                                                                                                                                                                                                                                                                                                        | 是会话选择策略，不是 crash recovery policy。                                                         |
| Fork            | `forkFrom()` 生成新 session ID/header 并复制历史；`AgentSessionRuntime.fork()` 可按 entry path 生成独立 session file。[SessionManager](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/session-manager.ts#L1571-L1629) [runtime](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session-runtime.ts#L259-L349)                                                                                                                        | 可作为显式 `ContextPolicy=fork` 的底层机制，但 fork 不是 retry identity。                            |
| Import          | `importFromJsonl()` 复制 JSONL 到 session dir、`open()` 并切换 runtime。[实现](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session-runtime.ts#L352-L393)                                                                                                                                                                                                                                                                                                                                            | 是 transcript/session 导入，不提供来源 hash、依赖版本验证或 attempt lineage。                        |

### 1.2 Session replacement 是对象替换，不是原地恢复

`AgentSessionRuntime` 管理 `/new`、resume、fork、clone、import。替换时会对旧 session 发出 `session_shutdown`、dispose 旧 session，再用有效 cwd 重新创建 services/session。成功后 `runtime.session` 指向新对象。订阅绑定在具体 `AgentSession` 上，因此调用者必须重新订阅；extensions 也必须重新绑定。创建或替换失败会 throw，由调用者处理。[SDK runtime contract](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/sdk.md#createagentsessionruntime-and-agentsessionruntime) [replacement implementation](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session-runtime.ts#L168-L257)

这意味着 replacement 可复用来实现交互式 session 切换，但不是 outer scheduler 的原子状态转换：旧 runtime 已 teardown 后，新 runtime 创建失败时没有 workflow-level rollback、lease 或 attempt terminal 记录。

### 1.3 Event stream

`AgentSession.subscribe()` 提供以下实时事件族：

- `agent_start` / `agent_end` / `agent_settled`；
- `turn_start` / `turn_end`；
- `message_start` / `message_update` / `message_end`；
- `tool_execution_start` / `update` / `end`；
- `queue_update`；
- `compaction_start` / `end`；
- `auto_retry_start` / `end`。

SDK 明确展示这些事件；agent-core 依序 await listeners，并在 `message_end` 更新 state，`agent_end` 后、所有 listener settled 才进入 idle。[SDK events](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/sdk.md#events) [agent lifecycle](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/agent/src/agent.ts#L468-L573)

这些事件是进程内 observation stream，不是 durable journal。除了最终 message 等 session entries，事件序列没有 cursor、ack、replay 或 exactly-once 保证。外层可以把它们规范化写入自己的 `JournalEvent`，但不能在重启后从 pi 自动重放 token/tool lifecycle。

### 1.4 Abort 与 dispose

- `AgentSession.abort()` 会停止 pi 的 auto-retry、调用 `agent.abort()`，然后等待 session idle。[实现](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session.ts#L1521-L1536)
- agent-core 用 `AbortController` 把 signal 传给 provider loop 和 tool execution。Custom tool 的 `execute(..., signal)` 必须自己尊重该 signal；abort 不是对任意第三方副作用的强制回滚。[tool contract](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/extensions/types.ts#L440-L475) [loop](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/agent/src/agent-loop.ts#L665-L705)
- `dispose()` 还 abort compaction、branch summary、bash 和 agent，invalidate extension context，断开 agent subscription 并清空 listeners；它是同步 cleanup，不等待所有异步副作用完成。[实现](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session.ts#L813-L837)

因此 TaskAttempt cancel 应由外层先 durable 记录 `cancellation_requested`，再 `await session.abort()`；超过 deadline 后杀 worker/sandbox，并根据观察结果写 `cancelled` 或 `lost`。不能以调用 `dispose()` 等价于业务取消已完成。

### 1.5 Compaction

Compaction 会总结旧 messages、append `CompactionEntry`（summary、kept boundary、token/usage、file-operation details），再用 summary + retained messages 重建 LLM context；原 JSONL 历史没有被删除。[文档](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/compaction.md#compaction) [实现](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session.ts#L1761-L1905)

自动 compaction 有两类：threshold 只压缩、不重试；context overflow 可压缩后在同一 session 自动 `continue()` 一次，并把旧 error 保留在 session history、但从 retry context 移除。[实现](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session.ts#L1926-L2003)

所以 compaction 是 **attempt 内 context maintenance**，不是新的 TaskAttempt，也不能替代 normal→compact 的 orchestration retry profile。

### 1.6 Provider retry 与 agent-level retry

pi 0.81 有两个 attempt 内 retry 层：

1. `retry.provider.*` 被传入 `ModelRuntime.streamSimple()`，默认 provider retry 为 0；
2. `retry.enabled/maxRetries/baseDelayMs` 对 retryable assistant error 进行指数退避，移除 in-memory error message 后在同一个 AgentSession 调用 `agent.continue()`；error message 仍保留在 JSONL history，事件以 `auto_retry_start/end` 暴露。默认 agent-level `maxRetries=3`。[settings](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/settings.md#settings-reference) [wiring](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/sdk.ts#L289-L325) [agent retry](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/agent-session.ts#L2610-L2678)

两层 retry 都没有新的 workflow `attemptId`，应计为一次 TaskAttempt 内的 provider/turn retry。若外层需要精确控制总尝试次数、模型降级或 cost budget，应禁用 pi agent-level retry，或把其固定设置写入 attempt snapshot 并消费事件计费；不能同时把 pi 的 `maxRetries` 和 outer `maxRetries` 都叫“Task retry”。

### 1.7 Tool loop 与 structured output

agent-core 的一个 prompt 可经历多个 LLM turn。assistant 返回 tool calls 后，pi 校验参数、执行工具、发出 tool events 和 tool-result messages，再继续调用模型。默认同一 assistant message 中的 tools 并行执行；任一 tool 声明 `executionMode="sequential"` 或 loop 配置为 sequential 时改为串行。Tool result 的 `terminate` hint 可结束 batch/loop。[tool-loop](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/agent/src/agent-loop.ts#L170-L269) [tool execution](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/agent/src/agent-loop.ts#L410-L552) [tool contract](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/agent/src/types.ts#L254-L286)

pi 的 SDK 提供 TypeBox/custom-tool 参数 schema 与 validation，但没有把“最终业务输出”自动建模为 workflow structured result。当前仓库自行注册 `StructuredOutput` custom tool：成功返回 `terminate:true`，失败把 field errors 作为 tool result 喂回模型并在 closure 中限制修复次数；execution layer 最后再次 deterministic validate。[当前实现](https://github.com/zubingtan/workflow/blob/24974b0e1d772044a2ccf37020815ca573fa70ff/server/structured-output.mjs#L171-L235) [terminal validation](https://github.com/zubingtan/workflow/blob/24974b0e1d772044a2ccf37020815ca573fa70ff/server/agent-execution.mjs#L269-L363)

当前 structured-output repair 次数属于同一 pi session/tool loop，不是 orchestration retry；并且本仓库当前 compiler 只允许 flat `string/integer/number/boolean` fields。[当前 schema compiler](https://github.com/zubingtan/workflow/blob/24974b0e1d772044a2ccf37020815ca573fa70ff/server/structured-output.mjs#L31-L149)

### 1.8 Tools、skills、extensions 与权限

`createAgentSession()` 可 allowlist/exclude 内置、custom 和 extension tools；内置工具包括 `read/bash/edit/write/grep/find/ls`。`ResourceLoader` 装配 skills、prompt templates、AGENTS/context 和 extensions；extensions 可注册 tools、订阅/修改 lifecycle、provider request 和 tool events。[SDK tools](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/sdk.md#tools) [SDK resources](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/sdk.md#resourceloader)

但 pi 官方明确声明：project trust 只是资源加载 guard，**不是 sandbox**；built-in tools、extensions、package installs、shell 和 developer tools 都继承 pi 进程的用户权限。真实 filesystem/process/network/credential 隔离必须来自 container、VM 或 policy sandbox。[security](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/security.md#no-built-in-sandbox) [containerization](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/docs/containerization.md#choose-a-pattern)

因此 tool allowlist 是能力发现/减少暴露面，不是 Permission Profile 的安全边界。Attempt worker 必须在外层 sandbox 中运行，extension 必须是部署时批准、版本固定的可信代码。

### 1.9 当前仓库的实际 session 粒度

当前 `AgentExecutor.execute()` 每次执行都调用 `createAgentSessionForAgent()`；该 factory 每次 `SessionManager.create()` 一个新 persistent session，并为本次执行创建 request-scoped ResourceLoader/custom tool closure。执行结束后 `agent-execution.mjs` unsubscribe 并 dispose session。[session factory](https://github.com/zubingtan/workflow/blob/24974b0e1d772044a2ccf37020815ca573fa70ff/server/runtime-adapter.mjs#L165-L257) [per-run tool/session options](https://github.com/zubingtan/workflow/blob/24974b0e1d772044a2ccf37020815ca573fa70ff/server/runtime-adapter.mjs#L270-L364) [cleanup](https://github.com/zubingtan/workflow/blob/24974b0e1d772044a2ccf37020815ca573fa70ff/server/agent-execution.mjs#L367-L380)

这已接近“fresh session per logical execution”，但当前 FlowGram node execution 尚无 durable `TaskAttempt` identity、lease 或 retry predecessor；session file 只是 execution record 的一个字段，不能反向推导 attempt 状态。

---

## 2. 崩溃与重启边界

### 已确认事实

1. `AgentSession` 当前持久化的是已完成的 messages/config/compaction entries；没有 provider request started/finished、tool call started/finished、operation started/finished 或 attempt lease entries。
2. Tool 执行完成后，loop 先 emit `tool_execution_end`，随后才构造并 emit/persist `toolResult` message。外部副作用可能已发生，但进程可在 result 持久化前崩溃。[顺序](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/agent/src/agent-loop.ts#L432-L480)
3. 上游 0.81 的“Durable AgentHarness”文档明确把 fully durable harness 判定为不现实，把目标描述为 semi-durable，并说明 provider stream 不可恢复；它还把 operation/tool start-finish entries、恢复策略和 idempotent tool metadata 列为需要的设计/后续工作，而非 `pi-coding-agent` 当前保证。[durable design](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/agent/docs/durable-harness.md#durable-agentharness-and-session-design)
4. `pi-coding-agent/createAgentSession()` 在 0.81 仍直接构造低层 `Agent`，并未使用 `AgentHarness` 的 recovery design。[factory](https://github.com/earendil-works/pi/blob/9c480b6ad2c7419875a7a850fb4ad5f9232313b8/packages/coding-agent/src/core/sdk.ts#L248-L385)

### 结论

进程崩溃中的 attempt 不能标记为普通 `failed`，也不能无条件 `open(session.jsonl)` 后 `continue()`：

- provider response 可能已产生但未写入；
- tool/external action 可能已产生副作用但没有 result entry；
- runtime tools/extensions/models/auth 不是 session 可序列化内容，恢复时必须由 host 重建；
- pi 没有 durable operation marker 证明上一 run 已到哪个安全边界。

外层 scheduler 应在 lease 失效后写 `TaskAttempt.status=lost`。纯认知 agent 可按 RetryPolicy 新建 fresh attempt；具有外部副作用的 tool/action 必须先 reconcile，只有声明 idempotent/retry-safe 才可自动重试。

---

## 3. 未知项

以下不能从 pi 0.81 的公开合同推出：

1. `appendFileSync` 返回后在 kill -9、内核/主机断电场景的 fsync 级 durability；pi 没有公开 fsync/transaction 保证。
2. 任意 provider 在 connection loss 时是否已经完成请求，以及其内部 retry 是否会重复收费/副作用。
3. 任意 custom tool/extension 是否尊重 `AbortSignal`、是否幂等、是否泄漏宿主权限；这取决于 host 注入代码。
4. 用新版本 model registry、skills、system prompt、extensions 打开旧 session 是否语义等价；session 没有统一的这些依赖的 content hash contract。
5. 多进程同时 open/append 同一 JSONL 的安全性；TaskAttempt 设计不应假设它是并发数据库。
6. `AgentHarness` durable design 何时、以何种兼容性进入 `pi-coding-agent` public SDK；0.81 文档中的 planned/future 项不能当作现有保证。

---

## 4. 推断

1. **一个 fresh AgentSession 提供较好的内存隔离，但不是 OS/security 隔离。** Messages、queues、retry counters、tool closure 和 extension runner 都属于 session instance；但 filesystem、process、network、credential 权限仍来自 worker process。
2. **JSONL 是 transcript/context checkpoint，不是 attempt journal。** 它足以审计已完成 messages 和 compaction，却不足以判定 crash 时 provider/tool 的精确状态。
3. **Continue/fork 应是显式 Context Policy。** 默认 retry 若复用旧 session，会让失败尝试的 hidden/history 污染下一尝试，并模糊 token/cost 和 transcript lineage。
4. **pi 内部 retry/repair 允许留在 attempt 内，但必须可观测和有总预算。** 否则 outer retry × pi retry × structured repair 会发生乘法放大。

---

## 5. 推荐的 TaskAttempt 合同

### 5.1 外层在创建 pi session 前持久化

```text
attemptId
taskExecutionId
attemptNo
status = created | leased | running | ...
leaseOwner / leaseExpiresAt / heartbeatAt
definitionVersionId / taskDefinitionId / expansionPath
resolved AgentConfiguration hash
resolved model/provider/API shape
resolved prompt/skills/extensions hashes
PermissionProfile + sandbox identity
input ArtifactRefs + schema hash
retry predecessor + reason
token/cost/wall-time/tool budgets
```

### 5.2 pi attempt adapter 可承诺

1. 为每个 `TaskAttempt` 创建一个 fresh persistent `AgentSession`；session dir/path 写回 attempt。
2. 在 worker sandbox 内装配固定版本 tools、skills、extensions、model 和 prompt。
3. 订阅完整 agent/turn/message/tool/compaction/retry event，并增量规范化到外层 journal；大 payload 外置为 Artifact。
4. `await session.prompt()` 直到 pi-local retries、tool loop 和 accepted follow-ups 结束。
5. 后端独立校验 structured result；invalid result 是 attempt outcome，不信任 transcript。
6. cancel 时 `await session.abort()`；finally unsubscribe/dispose。
7. 将原始 session JSONL 作为 transcript artifact，记录 content hash 和 pi exact version。

### 5.3 必须由外层承担

| 能力                                     | 原因                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Attempt identity/status/lease/heartbeat  | pi session 没有 workflow execution identity 或 durable worker ownership。 |
| Workflow retry/fallback/profile sequence | pi retry 只在同一 session 内重放 transient assistant/provider error。     |
| Crash recovery/reconcile                 | provider stream、unfinished tool side effect 不可由 transcript 安全恢复。 |
| Concurrency/token/cost/wall-time budgets | pi 只暴露局部 settings/events，没有 hierarchical workflow arbitration。   |
| Permission/sandbox/secrets               | pi 明确没有内建 sandbox。                                                 |
| Artifact lineage/retention/redaction     | Session JSONL 不是 artifact registry，且 raw events/tool args 可能敏感。  |
| Subworkflow/fan-out/pipeline/cancel tree | 这些是 workflow orchestration，不属于单 agent loop。                      |
| Manual retry/skip                        | 必须产生新的 durable attempt 或明确 skipped 状态，不能修改旧 session。    |

### 5.4 Retry 和 context 的默认规则

- `TaskAttempt 1`：`SessionManager.create()` fresh session。
- orchestration retry：创建 `TaskAttempt 2` + fresh session；通过 explicit input/ArtifactRef 传递需要保留的上下文。
- `continueFromSession` / `forkFromAttempt` / `seedFromSummary`：只能作为显式 ContextPolicy，写入 RunPlan 和 lineage。
- pi `retry.provider`、pi agent `auto_retry`、structured-output repair、overflow compaction retry：全部标为 `attempt-local`，事件和 usage 计入当前 attempt。
- deep-review 的 normal→compact 降级：两个 outer attempts/profile，而不是对失败 session 调 `compact()` 后继续。

### 5.5 Crash 判定

```text
worker lease expires while attempt=running
  → attempt=lost
  → if cognition-only and policy allows: create new attempt
  → if side effect possible: reconcile first
  → never overwrite/reopen old attempt as if uninterrupted
```

---

## 6. 对后续架构决策的直接输入

1. **pi session 边界：**默认 `1 TaskAttempt = 1 fresh AgentSession`。
2. **身份：**`attemptId` 由 workflow runtime 生成；`sessionId/sessionFile` 是 attempt 的 runtime reference。
3. **状态：**pi events 投影到 journal，但不作为 canonical status store。
4. **Retry：**outer attempt retry 与 pi-local retry 分层命名、分层计数、共同受总预算约束。
5. **Compaction：**只影响当前 session context，不改变 attempt identity。
6. **Recovery：**进程中断一律先 `lost`；MVP 不 resume in-flight pi turn。
7. **Security：**Agent Task 必须运行在外层 sandbox；tools allowlist/Project Trust 不作为安全证明。
8. **Structured output：**继续采用 custom tool + backend revalidation，但 nested schema、repair 次数和 tool-call budget 都是本项目的 adapter contract，不是 pi 的 TaskAttempt contract。

这组边界足以关闭“核实 pi 0.81 的 Task Attempt 生命周期与隔离能力”：无需等待 pi 上游提供 durable scheduler；本项目应把 pi 固定在 **Agent Task Attempt Runtime** 位置，并在其外构建 durable workflow runtime。
