# Design Doc：Oncall Workflow Platform 系统架构与执行模型

- **版本**：v0.4
- **状态**：Active Development Baseline
- **日期**：2026-07-14
- **当前实现范围**：M0
- **目标架构范围**：M0–M5
- **关联文档**：[PRD](./01-PRD.md) · [ADR](./03-ADR.md) · [Roadmap](./04-ROADMAP.md) · [Automated Acceptance](./09-MILESTONE-AUTOMATED-ACCEPTANCE.md)

---

## 1. 设计目标

平台需要把确定性的 Workflow Control Plane 与 Agent 的开放式推理能力组合起来，同时保证：

- 可部署；
- 可版本化；
- 可持久化；
- 可观察；
- 可恢复；
- 可测试；
- 可审计；
- 可逐步扩展。

M0 以最低基础设施成本证明最小闭环，不一次性实现目标架构。

## 2. 总体判断

Pi Agent 已经提供 Agent Runtime、工具调用、状态管理、事件流、上下文转换、Skills、Extensions、Packages 和可编程接口。平台不应重新实现这些通用机制。

平台必须补齐 Pi Agent 不负责的业务控制面：

- Workflow Definition / Version；
- Workflow Run / Node Run / Attempt；
- Thread / Incident；
- Interaction Request / Reply；
- 确定性编排；
- 权限、Secret 和 Tool Gateway；
- Artifact、Evidence 和审计；
- Workflow Test；
- Memory Governance；
- Channel Adapter；
- Milestone 自动化验收。

## 3. 架构原则

1. Workflow 控制确定性过程，Agent 控制节点内部推理。
2. Definition、Version、Run 和 Attempt 分离。
3. 平台公共模型不依赖 Pi 内部 Session 或消息类型。
4. Pi 的通用 Harness 能力优先复用。
5. Context Policy 由平台定义，Context Mechanism 由 Pi 和插件执行。
6. Channel 是 Adapter，不污染 Workflow Core。
7. Tool、Skill、Subagent 和 Workflow Node 语义分离。
8. 大输出外部化为 Artifact，模型只接收必要摘要或引用。
9. 执行事实通过持久化状态和事件表达。
10. Human Waiting 是可恢复状态，不是普通聊天文本。
11. Test Mode 使用与生产相同的执行模型，但替换副作用边界。
12. 目标架构不等于 Day-1 部署。

## 4. 总体架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Web / Channel / CLI                                         │
│ Workflows · Runs · Tests · Interactions · Artifacts          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│ Platform Control Plane                                      │
│ Definition · Version · Run · Policy · Test · Audit           │
└─────────────┬──────────────────────────┬─────────────────────┘
              │                          │
      ┌───────▼────────┐         ┌──────▼──────────┐
      │ Product State  │         │ Artifact Store  │
      │ PostgreSQL     │         │ files/evidence  │
      └───────┬────────┘         └─────────────────┘
              │
┌─────────────▼───────────────────────────────────────────────┐
│ Workflow Execution                                          │
│ Compiler · State Machine · Queue/Durable Backend · Recovery  │
└─────────────┬───────────────────────────────────────────────┘
              │ execute Agent Node
┌─────────────▼───────────────────────────────────────────────┐
│ Pi Runtime Integration                                      │
│ Context Policy Adapter · Skills/Extensions · Runtime Events  │
└─────────────┬───────────────────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────────────────┐
│ Model / Tool Gateway / Sandbox / External Integrations       │
└─────────────────────────────────────────────────────────────┘
```

横切能力：

- Execution Event；
- Trace / Metrics / Logs；
- Secret / Policy；
- Test Hook；
- Artifact / Evidence；
- Version Snapshot；
- Support Bundle。

## 5. M0 部署拓扑

M0 使用三个主要部署单元：

- `app`：Web 与 API；
- `worker`：Workflow 执行；
- `postgres`：产品状态与轻量 Queue。

可选：

- `migration`：一次性数据库升级；
- `fake-provider`：本地与 CI 的确定性模型替身；
- `object-storage`：M0 可用本地兼容实现，接口保持可迁移。

M0 不拆成大量微服务。

启动顺序：

```text
postgres healthy
  → migration
  → seed example workflow and agent
  → app healthy
  → worker healthy
  → smoke workflow available
```

## 6. 核心职责边界

### 6.1 Platform Control Plane

负责：

- Workflow 和 Agent 管理；
- Definition Version；
- Validation；
- Run 创建、查询和取消；
- Interaction；
- Test Case 和 Regression；
- Policy、Audit 和 UI Projection。

不负责：

- 在 HTTP Request 中执行完整 Workflow；
- 直接实现 Agent Loop；
- 保存明文 Secret；
- 暴露 Pi Session 为业务 ID。

### 6.2 Workflow Compiler

负责把用户 Definition 变成稳定的执行计划，并提前发现：

- Schema 错误；
- Node 引用错误；
- 不可达节点；
- 非法环；
- 数据映射不兼容；
- 未发布 Agent；
- 当前阶段不支持的节点；
- 模型能力不满足；
- Loop 无退出条件；
- Agent 无预算或 Interaction 无上限；
- Test Mode 中存在未替换的生产副作用。

### 6.3 Workflow Execution

负责：

- 创建 Run、Node Run 和 Attempt；
- 推进节点；
- 保存输入、输出、状态和错误；
- 调用 Pi Runtime；
- 处理 Waiting、Resume、Retry 和 Cancel；
- 处理 Stale Run；
- 发出持久化事件；
- 在 Test Mode 中接入 Stub 和 Assertion。

### 6.4 Pi Runtime Integration

负责：

- 将平台的 Agent Version、Context Policy 和可用能力映射到 Pi；
- 调用 Pi Agent；
- 订阅 Pi 的 Agent、Turn、Message 和 Tool 事件；
- 将 Runtime 结果转换为平台统一结果；
- 在 Pi 版本变化时保持兼容边界；
- 不向产品层泄漏 Pi 内部类型。

## 7. Context Engineering：职责划分

### 7.1 平台负责的 Context Policy

平台决定：

- 当前 Run、Node、Thread 和 Incident 的身份；
- 哪些前序节点输出可见；
- 哪些 Artifact、Evidence 和 Thread Summary 可用；
- 哪些 Skill Version 被批准；
- 哪些 Memory Scope 可检索；
- Test Run 是否允许读取生产数据；
- 敏感信息是否允许进入模型；
- 各上下文来源的预算和优先级；
- 本次执行实际使用了哪些来源；
- Replay 时需要冻结哪些 Version 和 Hash。

### 7.2 Pi Agent 与插件负责的机制

优先复用：

- 消息转换；
- 上下文裁剪、压缩或分支摘要；
- Skills 按需加载；
- Extensions 注入工具和事件；
- Agent Loop；
- Tool Call；
- Runtime Event；
- Session 与 Provider 缓存能力。

### 7.3 上下文来源

统一分为：

- **Run Context**：触发输入、环境、Actor、Incident；
- **Node Working Context**：当前节点输入、前序输出、当前 Tool 结果；
- **Thread Context**：近期交互、阶段摘要、Human Reply；
- **Knowledge Context**：Skill、Runbook、受控 Memory；
- **Artifact Context**：文件、日志、图表和大结果的摘要或引用；
- **Test Context**：Fixture、Stub、固定时间和断言配置。

原则：

- 不把所有信息永久塞入 `messages`；
- 大输出进入 Artifact；
- Context Summary 不等于长期 Memory；
- Subagent 默认使用隔离上下文；
- 任何自动裁剪都不得删除当前 Tool Call 所需的闭合信息；
- 执行记录保存 Context 来源清单，而不是默认保存全部敏感正文。

## 8. 核心领域对象

### 8.1 定义对象

- `Workflow`
- `WorkflowDefinitionVersion`
- `Agent`
- `AgentDefinitionVersion`
- `SkillDefinitionVersion`
- `ToolDefinitionVersion`

### 8.2 执行对象

- `WorkflowRun`：一次完整业务执行；
- `NodeRun`：一个节点在 Run 中的逻辑执行；
- `NodeRunAttempt`：一次具体尝试，Retry 不覆盖旧 Attempt；
- `AgentExecution`：一次 Pi Runtime 执行；
- `ExecutionEvent`：追加式执行事实；
- `Artifact`：文件、大输出、报告和证据；
- `InteractionRequest / Reply`：人工交互；
- `Approval`：高风险动作授权。

### 8.3 业务上下文对象

- `ConversationThread`：Channel 或 Web 中的连续交互载体；
- `Incident`：Oncall 业务对象；
- `Evidence`：支撑结论的可引用事实；
- `MemoryEpisode / Revision`：运行事实与派生知识。

建议关系：

```text
Incident
  └─ ConversationThread
      └─ WorkflowRun
          └─ NodeRun
              └─ NodeRunAttempt
                  └─ AgentExecution
```

关系不是强制一对一：

- 一个 Incident 可有多个 Thread 和 Run；
- 一个 Run 可创建多个 Agent Thread；
- Replay 默认创建新 Run，可选择复用或隔离 Thread Context。

## 9. Workflow DSL

### 9.1 事实来源

- JSON Definition 是事实来源；
- UI 只编辑并生成该 Definition；
- Definition Version 不可变；
- 每个 Run 保存 Version 和 Hash。

### 9.2 三类语义分离

- **Control Flow**：节点何时执行；
- **Data Mapping**：业务字段如何传递；
- **Runtime Context**：Run、Thread、Actor、Incident、Trace 和 Test 等平台注入信息。

M0 示例只需表达：

```text
input.prompt → process.agent → output.markdown
```

不在 M0 引入自由表达式或任意代码。

### 9.3 Node Family

一级类型保持：

- Input；
- Process；
- Logic；
- Output。

具体 Node Type 由 Registry 管理。`family` 应由 Node Type 推导或被 Compiler 严格校验，不能形成两个冲突事实来源。

## 10. 执行状态与事件

### 10.1 Run 状态

- queued；
- running；
- waiting；
- succeeded；
- failed；
- cancelled。

### 10.2 Node 状态

- pending；
- queued；
- running；
- waiting；
- succeeded；
- failed；
- skipped；
- cancelled。

### 10.3 Attempt

每次 Retry、Crash Recovery 或 Manual Retry 创建新 Attempt。旧 Attempt 保留：

- 开始和结束时间；
- 执行后端；
- 错误；
- Provider / Model；
- Tool 调用；
- 上下文来源摘要；
- 终止原因。

### 10.4 Execution Event

事件至少覆盖：

```text
workflow.run.created / started / completed / failed
node.attempt.started / completed / failed
agent.execution.started / completed / failed
agent.turn.started / completed
tool.call.requested / completed / failed
interaction.requested / answered / expired
artifact.created
```

要求：

- 事件持久化；
- 具有顺序号；
- SSE 是事件的投影；
- 支持断线续传；
- UI、测试、审计和 Support Bundle 使用同一事件来源；
- 状态表表示当前状态，事件表示历史事实。

## 11. Agent 执行边界

每个 Agent Node 必须有：

- Agent Version；
- 可用 Tool / Skill；
- Context Policy；
- Interaction Policy；
- 执行预算；
- Output Contract；
- 明确终止原因。

建议预算维度：

- 最大模型轮次；
- 最大 Tool Call；
- 最大 Subagent；
- 最大等待轮次；
- 超时；
- Token / Cost；
- 无进展轮数。

终止原因至少区分：

- completed；
- waiting_for_human；
- budget_exceeded；
- no_progress；
- cancelled；
- provider_failed；
- tool_failed；
- output_invalid；
- outcome_unknown。

`completed` 不得仅表示“模型停止输出”，还要求输出满足 Schema、无未闭合交互或 Tool Call，并满足节点完成条件。

## 12. Tool、Skill 与 Subagent

### 12.1 Tool

可执行能力，例如查询日志、读取指标、创建 Draft。

Tool Gateway 负责：

- Registry；
- Schema；
- Secret Binding；
- Policy；
- Timeout；
- Retry；
- Idempotency；
- Audit；
- Evidence；
- Test Stub。

写操作执行结果无法确认时使用 `outcome_unknown`，不得盲目自动重试。

### 12.2 Skill

领域方法和 Runbook，例如：

- 高 CPU 诊断；
- CrashLoop 排查；
- 定位 Issue 分析模板。

Skill：

- 独立版本化；
- 按需加载；
- 声明所需 Tool；
- 可在 Test Case 中冻结 Version；
- 不等同于长期 Memory。

### 12.3 Subagent

Subagent 是 Agent 节点内部的短生命周期委派，不是动态 Workflow Node。

约束：

- 最大并发；
- 最大总数；
- 最大递归深度；
- 时间、Token 和成本预算；
- Tool Allowlist；
- 输出结构；
- 失败传播策略。

稳定、需要独立恢复和审计的业务步骤必须建成 Workflow Node。

## 13. Artifact、Workspace 与 Sandbox

### 13.1 Artifact

Artifact 保存：

- 输入附件；
- Tool 大结果；
- Agent 报告；
- Transcript；
- Evidence；
- Test Snapshot；
- Checkpoint；
- 生成文件。

至少记录来源、Hash、类型、大小、敏感级别和保留策略。

### 13.2 Workspace

Workspace 是一次 Agent Execution 的临时工作目录：

```text
uploads    immutable input
workspace  temporary work
outputs    publishable results
```

### 13.3 Sandbox

Pi 默认继承宿主进程权限，因此团队使用任意代码或文件工具前必须提供独立 Sandbox 和策略。

演进顺序：

- M0–M1：无任意代码；
- M2：仅可信本地实验，不进入默认发行路径；
- M3：只读 Tool Gateway；
- M5：容器或等价 Sandbox、资源/网络/文件/Secret 策略。

## 14. Human Interaction 与 Durable Execution

Agent 可通过平台能力请求 Human Input：

```text
running → waiting → running → terminal
```

要求：

- Request 和 Reply 持久化；
- Reply 绑定 Thread、Actor 和 Schema；
- 重复 Reply 只消费一次；
- 等待期间服务重启不丢失；
- Timeout 有明确分支；
- 最大交互轮数有效；
- Test Mode 可脚本化。

M2 必须采用 Durable Execution。Temporal 是首选候选，但需在 M1 完成验证性 Spike，证明等待、Signal、Retry、升级和本地开发体验符合要求。

## 15. Provider 与模型能力

Agent 或环境通过受控 Binding 解析实际模型，Run 保存最终 Effective Model 和参数。

模型能力至少考虑：

- Tool Calling；
- Structured Output；
- Streaming；
- Vision；
- Reasoning；
- Parallel Tool Calls；
- Context Window；
- Max Output。

发布前验证 Agent 需求不超过模型能力。Provider 更换不修改 Workflow Definition。

## 16. 存储

PostgreSQL 保存：

- Definition / Version；
- Run / Node / Attempt；
- Interaction；
- Test；
- Policy 和 Audit 索引；
- Memory Metadata；
- Event Index 或早期事件记录。

Artifact Store 保存：

- 大日志；
- Transcript；
- 附件；
- 报告；
- 图表；
- 数据文件；
- 验收证据。

M0 可使用本地兼容存储，但调用方不依赖本地路径。

## 17. 测试与可观察性

### 17.1 测试原则

- 真实模型不作为普通 CI 硬依赖；
- Fake Provider 输出确定性响应和 Tool Call；
- 故障注入覆盖超时、断线、Crash 和重复事件；
- 浏览器 E2E 验证关键用户路径；
- 语义质量使用固定 Evaluation Set；
- 单一 LLM Judge 不能掩盖确定性安全失败。

### 17.2 可观察性

M0：

- Run / Node / Attempt ID；
- 状态转换；
- Provider 延迟；
- 错误分类；
- Queue 和 Worker 健康；
- Secret Redaction。

后续：

- Token / Cost；
- Event Lag；
- Interaction Wait；
- Tool 调用；
- Artifact；
- Memory Decision；
- Trace；
- Test Assertion。

### 17.3 工程诊断

统一提供：

```bash
make doctor
make smoke-test
make support-bundle
```

Support Bundle 必须脱敏，包含版本、配置摘要、迁移状态、服务健康、最近结构化错误和验收报告索引。

## 18. 安全边界

M0–M3：

- 默认 localhost 或受控网络；
- Secret 仅服务端；
- 只读和 Draft；
- Test Run 默认 Output Sink；
- 普通日志不保存 Secret；
- Artifact 有访问控制；
- Prompt、Runbook、Memory 和 Tool Output 均视为不可信输入。

M3 接入 Feishu 前必须具备：

- Event 签名校验；
- 重放保护；
- 用户或群 Allowlist；
- Thread Ownership；
- 允许回复者校验；
- Artifact 安全下载；
- 最小认证边界。

完整 Workspace、RBAC、Quota 和 Sandbox 在 M5 完成。

## 19. 阶段演进

- M0：最小执行、持久化、Fake Provider 和只读 Board；
- M1：可靠性、事件、Test Case、Replay 和 Durable Backend Spike；
- M2：Waiting、Interaction、Logic、Loop 和 Child Workflow；
- M3：Feishu、只读 Tool、Evidence、Golden Evaluation 和 Memory Shadow；
- M4：Visual Authoring、Integrated Test Mode 和 Publish Gate；
- M5：Auth、Workspace、RBAC、Sandbox、Quota、Audit 和平台 SLO。

## 20. 关键风险

| 风险 | 设计缓解 |
|---|---|
| 重复实现 Pi Harness | 明确 Pi Runtime Integration 边界 |
| Workflow 与 Agent 职责混乱 | 确定性过程留在 Workflow |
| 长等待恢复失败 | M1 Spike，M2 Durable Execution |
| Tool 重试造成重复副作用 | Idempotency 与 outcome_unknown |
| 上下文无限增长 | Budget、Compaction、Artifact 外部化 |
| Memory 错误传播 | Episode、Quarantine、Shadow、Ablation |
| UI 先于 Runtime 固化 | M4 才实现完整 Builder |
| 真实模型测试不稳定 | Fake Provider + 固定 Evaluation Set |
| 多人使用前安全不足 | M3 最小安全基线，M5 完整隔离 |
| 文档与代码漂移 | 自动化文档门禁和 Milestone Evidence |

---

## 21. DeerFlow 借鉴与边界

DeerFlow 对本项目最有价值的不是其 Lead Agent 主导的全局运行式编排，而是围绕长任务形成的工程化 Harness 能力。

### 直接借鉴

- Harness 与产品应用分层；
- Thread/Checkpoint 与长任务恢复意识；
- Skill 按需加载；
- Subagent 隔离上下文与并发限制；
- 大输出外部化为文件或 Artifact；
- Sandbox 分级；
- Token、成本、日志和 Trace 可观察性；
- `setup`、`doctor`、健康检查和支持包等工程体验；
- 任务预算、循环检测和完成条件。

### 调整后借鉴

- Lead Agent 只允许存在于单个 Agent Node 内部；
- Thread 是上下文载体，但不等同于 Workflow Run 或 Incident；
- Memory 自动提取必须增加 Evidence、Scope、Quarantine 和离线评测；
- Subagent 是内部委派，不替代稳定 Workflow Node。

### 明确不照搬

- 不让一个开放式 Lead Agent 替代 Workflow Engine；
- 不把全部历史、Memory、Skill 和 Tool Schema 无差别注入上下文；
- 不允许 Agent 或插件绕过 Tool Gateway 直接使用生产凭据；
- 不用运行时 Session 代替平台级版本、状态和审计模型；
- 不因为已有 Sandbox 能力而省略平台权限与安全治理。

因此，本项目与 DeerFlow 的关系是：

> **借鉴其 Agent Harness 的成熟工程机制，但保留 Oncall 所需的确定性 Workflow、权限、测试和审计控制面。**
