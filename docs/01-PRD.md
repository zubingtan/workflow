# PRD：基于 Pi Agent 的 Oncall Workflow Platform

- **版本**：v0.6
- **状态**：Active Product Baseline
- **日期**：2026-07-17
- **当前产品增量**：M0 Local Workflow Walking Skeleton
- **目标架构范围**：M0–M5

## 1. 执行摘要

本项目构建一个面向 5–30 人工程或算法团队的可信 Oncall Workflow Platform，将告警、上下文收集、专业 Agent、人工补充、只读工具、证据、结果输出、测试和经验沉淀组织为版本化 Workflow。

核心价值不是“让 Agent 自由做更多事情”，而是：

- 过程有结构；
- 输入输出显式；
- 执行状态可见；
- 失败和等待可解释；
- 结论与证据可追踪；
- 修改可以回归；
- 外部动作有权限边界；
- 历史可以复用和审计。

## 2. 问题定义

小团队 Oncall 流程通常散落在聊天、监控、日志、代码仓库、Runbook、脚本和个人经验中，造成：

- 相同问题反复人工处理；
- 分析步骤无法复用或版本化；
- Agent 缺少上下文时容易猜测；
- 结果没有统一 Evidence 和 Run 历史；
- 系统重启、超时或工具失败后状态不清；
- Workflow 改动缺少回归；
- Secret、Tool 和生产写操作边界不清；
- 经验可能过期、冲突或被错误摘要污染；
- 可视化编辑器容易先于执行语义扩张。

核心问题是：

> 如何把确定性的 Workflow Control 与开放式 Agent 推理组合起来，并逐步达到可恢复、可测试、可审计和可安全扩展。

## 3. 产品愿景

用户可以把一次 Oncall 处理过程定义成 Workflow：

```text
Trigger
  → Collect Context
  → Specialist Agent
  → Tool / Evidence
  → Human Input when needed
  → Decision / Report
  → Optional Action
  → Review and Memory Curation
```

平台应支持从“本地最小 Workflow”逐渐演进到“小团队可信自动化”，而不是一次建设所有能力。

## 4. 用户

### 4.1 首要用户

- 5–30 人工程、算法、基础设施或平台团队；
- 有 Oncall、告警分析、Issue 定位和跨系统信息收集需求；
- 希望把重复排障过程沉淀为 Workflow；
- 初期接受本地或单团队部署；
- 重视证据、人工确认、审计和可控自动化。

### 4.2 次要用户

- Workflow 维护者；
- Agent/Tool 开发者；
- Oncall 值班人员；
- 团队负责人或 Reviewer；
- 平台管理员。

## 5. Jobs to Be Done

用户需要：

1. 快速创建或导入一个 Workflow；
2. 在 Web 中理解 Workflow 的节点、路径和状态；
3. 提交输入并启动 Run；
4. 查看每个步骤的输入、输出、错误和耗时；
5. 在 Agent 信息不足时补充信息或审批；
6. 将证据与结论关联；
7. 把失败 Run 转化为 Test Case；
8. 比较 Workflow/Agent 版本效果；
9. 通过 Feishu 等 Channel 触发和回复；
10. 在安全边界内复用工具和历史经验。

## 6. 产品原则

1. Workflow 控制确定性过程，Agent 控制节点内部推理。
2. JSON Definition 是业务事实来源。
3. Definition、Authoring、Runtime 和 Run Snapshot 分层。
4. Pi Agent 是 Runtime，不是平台业务模型。
5. FlowGram 是 Workflow UI Framework，不是生产执行引擎。
6. 用户可见功能先于发布工程。
7. 测试保护行为和风险，不保护施工细节。
8. 失败、等待、恢复和取消最终都属于核心产品能力。
9. 高风险 Tool 必须经过 Policy、Approval、Idempotency 和 Audit。
10. Memory 先保存事实，再产生受审查、可撤销的派生知识。
11. 真实 Oncall 价值优先于节点数量。
12. 不以复杂度、文档数量或测试数量作为进度指标。

## 7. 完整产品能力

### 7.1 Workflow Management

- Workflow / Definition Version；
- Draft / Publish / Archive；
- JSON Schema 和 Compiler；
- Input / Process / Logic / Output Node Family；
- Typed Ports；
- Control Transition、Data Mapping、Error Transition 分离；
- Branch、Guard、Loop、Child Workflow；
- Version Diff 和 Rollback；
- FlowGram Authoring。

### 7.2 Execution

- WorkflowRun / NodeRun / Attempt；
- 异步执行；
- ExecutionEvent；
- Retry / Cancel / Timeout；
- Waiting / Resume；
- Durable Execution；
- Crash Recovery；
- Idempotency；
- Replay；
- Cost、Token 和 Budget；
- Termination Reason。

### 7.3 Agent Runtime

- Agent Definition / Version；
- Pi Runtime Adapter；
- Provider / Model Policy；
- System Prompt；
- Tool / Skill / Context / Memory Scope；
- Structured Output；
- Runtime Event normalization；
- Subagent delegation；
- Completion Contract。

### 7.4 Human Interaction

- Agent 主动请求补充信息；
- 显式 Human Input；
- Approval Checkpoint；
- Actor / Schema / Timeout / Resume；
- Web 和 Channel 共用领域模型；
- 一个 Interaction 对应同一 Run/Node 上下文。

### 7.5 Tool and Evidence

- Tool Registry；
- Tool Gateway；
- Secret Binding；
- Read / Draft / Write 风险等级；
- Policy / Approval；
- Timeout / Retry / Idempotency；
- Evidence / Artifact；
- Audit；
- Test Stub。

### 7.6 Workflow Testing

- Static Validation；
- Fixture；
- Fake Provider；
- Tool Stub；
- Scripted Human Reply；
- Test Clock；
- Expected Path；
- Deterministic Assertion；
- Semantic Evaluation；
- Replay / Compare / Regression；
- Publish Gate。

### 7.7 Channel

- Web；
- CLI；
- Feishu Trigger / Ack / Reply / Card Output；
- Dedup / Correlation；
- Identity Mapping；
- Channel Simulator。

### 7.8 Memory

- Immutable Episode；
- Candidate Extraction；
- Review；
- Hard Gate；
- Conflict Resolution；
- Active / Quarantine / Reject / Supersede / Expire；
- Scope；
- Provenance；
- Shadow / Offline A/B / Kill Switch。

### 7.9 Team and Security

- Workspace；
- Auth / RBAC；
- Audit；
- Secret Lifecycle；
- Artifact Access；
- Quota；
- Retention；
- Sandbox；
- Production SLO。

## 8. 当前增量：M0 Functional Gate

M0 当前只证明一条真实纵向路径：

```text
clone
  → configure
  → start
  → open Web
  → view Input / Agent / Output
  → enter Prompt
  → Run
  → view status
  → view final Markdown result
```

### 8.1 必须实现

- 一条明确启动命令；
- 默认 Fake Provider，无外部凭证也能演示；
- 可选真实 OpenAI-compatible Provider；
- 一个服务端 JSON Workflow Definition；
- `input.prompt`；
- `process.agent`；
- `output.markdown`；
- Web 中展示三个节点或等价清晰结构；
- Prompt 输入；
- Run 按钮；
- pending/running/succeeded/failed；
- 结果与错误展示；
- README 可复现；
- 至少一个真实 happy-path smoke/integration test。

### 8.2 允许简化

为了优先交付产品闭环，M0 可以：

- 使用单进程 App + API + Runtime；
- 使用内存状态或轻量持久化；
- 使用简单 CSS/HTML 结构展示 Workflow；
- 使用 polling；
- 只支持一个 seed Workflow；
- 只支持单次 Attempt；
- 不实现版本发布 UI。

但接口和模块边界不得把这些简化写死，后续可平滑演进。

### 8.3 明确不做

- FlowGram 接入；
- 完整 Workflow Builder；
- 独立 Worker/Queue/Lease；
- Crash Recovery；
- ExecutionEvent Stream；
- SSE Resume；
- Retry/Cancel；
- Human Interaction；
- Feishu；
- Tool Gateway；
- Memory；
- Evidence Bundle；
- 全量自动验收矩阵。

## 9. Golden Workflow

业务价值验证使用定位 Issue 分析：

```text
Feishu Trigger
  → Normalize / Ack
  → Router
  → Data Analysis Agent
  → Human Input if needed
  → Algorithm Analysis Agent
  → Sufficiency Guard / Controlled Loop
  → Evidence-backed Report
  → Feishu Card
  → Async Memory Curation
```

该 Workflow 是 M3 业务门禁，不应在 M0/M1 被提前完整实现。

## 10. 非功能需求

### 10.1 可靠性

- M0：happy path 可重复运行，错误可读；
- M1：Run 和事件可持久化；
- M2：Crash、Retry、Cancel、Waiting 可恢复；
- M3+：外部副作用具备 Idempotency、Approval 和 Audit。

### 10.2 安全

- Secret 仅服务端读取；
- `.env.example` 不含真实 Secret；
- 日志和错误脱敏；
- 外部文本、Tool Output、Memory、Skill 均视为不可信输入；
- M5 前不开放任意代码执行；
- 生产写 Tool 晚于明确审批和审计。

### 10.3 可维护性

- Product Model 不依赖 Pi 或 FlowGram 内部类型；
- Runtime、Canvas、Channel 使用 Adapter；
- 演进通过 migration 和兼容层，而不是一次预建全部抽象；
- 当前 Goal 不做无关重构。

### 10.4 可用性

- 用户总能看到当前状态；
- 错误回答：发生了什么、能否重试、下一步是什么；
- 结果与输入、Workflow 和 Run 可关联；
- 移动端优先查看、回复和审批，不承担完整 Authoring。

## 11. 成功指标

### 当前阶段

- 新环境能按 README 启动；
- 页面可打开；
- 最小 Workflow 可运行；
- Fake Provider 结果可见；
- 错误不以空白页或无响应结束；
- 不需要阅读内部代码才能完成演示。

### 平台阶段

- 首次有效诊断时间；
- Workflow 重用次数；
- Evidence 覆盖率；
- Human 补充信息后的解决率；
- 重复副作用率；
- Crash 后不可解释 Run 比例；
- 发布前发现的有效回归；
- Memory 正向/无影响/负向贡献。

## 12. 验收策略

每个里程碑使用双门：

- Functional Gate 证明核心用户任务；
- Hardening Gate 证明进入下一风险等级所需的可靠性。

测试数量、文档数量、代码行数和 Evidence 数量都不是产品验收指标。
