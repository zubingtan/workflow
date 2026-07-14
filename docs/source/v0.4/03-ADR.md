# ADR：Oncall Workflow Platform 当前架构决策

- **版本**：v0.4
- **状态**：Active Development Baseline
- **日期**：2026-07-14
- **适用范围**：基于 Pi Agent 的 Oncall Workflow Platform

本文件是当前决策索引和汇总。正式进入仓库后，一个重要决策应拆为一个 ADR 文件。

## 1. 状态定义

- **Accepted**：当前实现必须遵循；
- **Proposed**：等待批准；
- **Deferred**：已识别但暂不实施；
- **Superseded**：被新 ADR 替代；
- **Rejected**：当前不得实施。

决策状态与实施阶段分开记录，不使用 `Accepted / Deferred` 组合状态。

## 2. 决策总览

| ADR | 决策 | 状态 | 生效阶段 |
|---|---|---|---|
| 0001 | 产品定位为可信 Oncall Workflow Platform | Accepted | 立即 |
| 0002 | 首阶段统一称为 M0 | Accepted | 立即 |
| 0003 | JSON Workflow Definition 是事实来源 | Accepted | M0 |
| 0004 | Node Family 为 Input/Process/Logic/Output | Accepted | 全阶段 |
| 0005 | Control Flow、Data Mapping、Runtime Context 分离 | Accepted | 全阶段 |
| 0006 | Workflow、Agent Definition、Run 分开建模 | Accepted | 全阶段 |
| 0007 | Pi Agent 是当前唯一支持的 Agent Runtime | Accepted | M0+ |
| 0008 | Run 从第一天异步并持久化 | Accepted | M0 |
| 0009 | M0 PostgreSQL Queue，M2 固定采用 Temporal | Superseded | 由 0024 替代 |
| 0010 | Definition Version 不可变 | Accepted | M0 |
| 0011 | Provider Secret 不属于 Workflow | Accepted | M0 |
| 0012 | Feishu 通过 Channel Adapter 接入 | Accepted | M3 |
| 0013 | Agent 可主动请求 Human，Node 显式 Waiting | Accepted | M2 |
| 0014 | 循环只能由 Compiler 管理为受控 Loop | Accepted | M2+ |
| 0015 | 任意代码节点延后，团队使用前必须隔离 | Accepted | M5 |
| 0016 | Tool Gateway 是生产工具统一边界 | Accepted | M3 |
| 0017 | Memory 使用 immutable episode、自动审核与确定性解析 | Accepted | M3+ |
| 0018 | 完整可视化 Builder 延后到 M4 | Accepted | M4 |
| 0019 | PostgreSQL 保存状态，Artifact Store 保存大对象 | Accepted | M0+ |
| 0020 | 早期权限仅开放 Read 与 Draft | Accepted | M0–M3 |
| 0021 | Docs-as-Code 和单一现行基线 | Accepted | 立即 |
| 0022 | Workflow Test 是一等产品对象 | Accepted | M1+ |
| 0023 | Design/Test/Run 使用统一 Workflow 视觉语言 | Accepted | M0/M4 |
| 0024 | M2 要求 Durable Execution；Temporal 需经 Spike 验证 | Accepted | M1/M2 |
| 0025 | Pi 实现 Context 机制，平台定义 Context Policy | Accepted | M0+ |
| 0026 | Execution Event 追加持久化，Retry 创建独立 Attempt | Accepted | M1+ |
| 0027 | Thread、Incident、Run 和 Node 不混用 | Accepted | M1+ |
| 0028 | Tool、Skill、Subagent 和 Workflow Node 分离 | Accepted | M1+ |
| 0029 | Agent 必须有预算、完成契约和终止原因 | Accepted | M1+ |
| 0030 | Agent 需求必须与 Effective Model Capability 匹配 | Accepted | M1+ |
| 0031 | Artifact、Workspace 和 Sandbox 分离 | Accepted | M1+ |
| 0032 | 每个 Milestone 必须有一键自动化验收和证据包 | Accepted | 立即 |
| 0033 | Feishu 接入前必须达到最小安全基线 | Accepted | M3 |

---

# ADR-0001：产品定位

## Context

项目需要统一定义和执行告警触发、上下文收集、多个 Agent、Human Interaction、工具、结果、测试和 Memory。

## Decision

面向小团队的可信 Oncall Workflow Platform，优先验证真实 Oncall 价值。

## Alternatives Considered

- 通用聊天产品；
- 通用低代码平台；
- 全自治生产处置 Agent。

## Consequences

Evidence、Interaction、Testing、Audit 和安全边界优先于节点数量。

## Validation

M3 Golden Workflow 指标达到 Roadmap 门槛。

---

# ADR-0003：JSON Definition 是事实来源

## Context

若 UI 状态和 Runtime Definition 各自保存，会产生不可解释差异。

## Decision

服务端校验并存储版本化 JSON。M0 Board 只读，M4 Builder 生成同一 DSL。

## Alternatives Considered

- UI 内部模型为事实来源；
- 直接把画布状态作为 Runtime 输入。

## Consequences

前期需要稳定 Schema，但可实现 Import、Diff、Replay 和自动校验。

## Rollback

如 DSL 无法表达目标场景，以新 apiVersion 演进，不修改历史 Version。

## Validation

所有示例通过 Schema；Builder Round-trip 不改变语义。

---

# ADR-0005：三类数据语义分离

## Decision

- Edge 表达 Control Flow；
- Mapping 表达业务字段；
- Runtime Context 由平台受控注入。

## Consequences

类型检查、测试、Thread 恢复和审计不依赖隐式变量。

## Validation

Compiler 能独立报告流程错误、映射错误和上下文权限错误。

---

# ADR-0006：领域对象分离

## Decision

Workflow Definition、Agent Definition、Workflow Run、Node Run 和 Runtime Session 分离。

## Consequences

Agent 可复用，历史 Run 可解释，Pi 内部实现不泄漏。

## Validation

任一历史 Run 均可定位 Workflow Version、Agent Version 和 Effective Model。

---

# ADR-0007：Pi Agent 是当前唯一 Runtime

## Context

Pi 提供可嵌入 Agent Runtime、工具调用、事件、Context Transform、Skills、Extensions 和 SDK。

## Decision

当前只实现 Pi Runtime Integration。新增 Runtime 必须通过新 ADR。

## Alternatives Considered

- 自建 Agent Loop；
- 同时支持多个 Harness；
- 直接采用 DeerFlow 作为全局编排器。

## Consequences

降低 M0 范围；需要维护 Pi 版本兼容测试。

## Validation

Fake Provider 和真实 OpenAI-compatible Provider 均通过 Pi Adapter；平台公共 API 不出现 Pi 内部类型。

---

# ADR-0008：异步持久化 Run

## Decision

API 创建 Run 后立即返回 ID；Worker 异步执行。Run、Node 和 Attempt 持久化。

## Consequences

禁止把完整模型调用绑定到 HTTP 生命周期。

## Validation

关闭客户端或重启 App 不影响已提交 Run 的可解释性。

---

# ADR-0010：Definition Version 不可变

## Decision

每次修改产生新 Version；Run 保存 Version 和 Hash。

## Validation

历史 Run 重开时显示原始 Definition，不能被当前 Draft 覆盖。

---

# ADR-0011：Secret 不属于 Workflow

## Decision

Definition 只引用 Binding。Secret 不进入浏览器、Definition、Run 或普通日志。

## Validation

自动 Secret Scan 和 Support Bundle Redaction 通过。

---

# ADR-0012：Feishu 是 Channel Adapter

## Decision

Feishu 实现 Trigger、Ack、Interaction、Output、Dedup 和 Correlation，不新增一级 Node Family。

## Validation

Feishu Event Simulator 与真实 Adapter 使用相同标准事件契约。

---

# ADR-0013：Agent 主动 Human Interaction

## Decision

Agent 调用平台能力后，同一 Node 进入 `waiting`；Reply 后恢复同一 Node。显式 Human Node 仍用于预定义检查点。

## Consequences

需要 Durable Execution、幂等 Reply、超时和 Test Script。

## Validation

M2 故障注入覆盖重启、重复 Reply、Timeout 和最大轮数。

---

# ADR-0014：受控 Loop

## Decision

只允许 Compiler 可识别的 Loop Region，必须有 Exit Condition、Max Iterations 和超限策略。

## Validation

无界环发布失败；达到上限产生明确终态。

---

# ADR-0015：任意代码延后

## Decision

M0/M1 不支持。M2 仅允许可信本地实验且默认关闭。团队开放前必须 Sandbox。

## Validation

M0–M3 发布包中不存在可从 Channel 触发的任意代码路径。

---

# ADR-0016：Tool Gateway

## Decision

生产 Tool 必须经过 Registry、Schema、Policy、Secret、Timeout、Idempotency、Approval、Audit、Evidence 和 Test Stub。

## Validation

未注册或权限不匹配 Tool 被阻止；写操作结果未知时不自动重试。

---

# ADR-0017：Memory Curation

## Decision

采用 immutable episode、候选提取、硬门禁、独立 Review、确定性冲突解析、Quarantine 和 TTL。

## Consequences

Memory 晚于核心执行实现，且先 Shadow 后召回。

## Validation

固定 Memory Corpus、Secret/PII、冲突、时序、TTL 和负向影响测试通过。

---

# ADR-0018：Builder 延后到 M4

## Decision

M0 使用只读 Board；完整 Authoring 在 Runtime 和 DSL 稳定后实现。

## Validation

M4 Builder 可无损导入导出 Golden Workflow，并通过发布门禁。

---

# ADR-0019：状态与 Artifact 分离

## Decision

结构化状态进 PostgreSQL；大日志、文件、报告和 Transcript 进 Artifact Store。

## Validation

数据库备份不因大输出无限增长；Artifact 可按 Hash 和权限读取。

---

# ADR-0020：早期仅 Read / Draft

## Decision

M0–M3 默认禁止自治生产写操作。

## Validation

Test 和 Production Policy Matrix 均阻止未批准写操作。

---

# ADR-0021：Docs-as-Code

## Decision

一个 Active PRD、一个 Current Roadmap、一个 ADR Index；实现任务使用 Milestone Plan 和 Issue Tracker。

## Validation

CI 检查链接、版本、Frontmatter、ADR 编号和 Schema 示例。

---

# ADR-0022：Workflow Test 一等化

## Decision

Test Case 独立保存 Fixture、Stub、Human Script、Assertion 和 Version Binding。

## Validation

失败 Run 可转 Test Case；Version 变更可 Replay 和 Compare。

---

# ADR-0023：统一视觉语言

## Decision

Design、Test 和 Run 使用相同节点位置和状态语言；运行事件不动态改写 Definition 图。

## Validation

用户可在三个模式间切换并理解同一 Node 的定义和运行状态。

---

# ADR-0024：Durable Execution 先锁能力，再锁实现

## Context

M2 需要小时或天级等待、Signal、Timer、重启恢复和 Child Workflow。直接提前锁死具体产品存在迁移和开发体验风险。

## Decision

M2 必须采用 Durable Execution。Temporal 是首选候选，在 M1 完成 Spike 后正式确认。

Spike 必须验证：

- 等待与 Signal；
- Worker / Server 重启；
- Duplicate Signal；
- Durable Timer；
- Retry；
- Child Workflow；
- Definition 升级；
- 本地 Docker 体验；
- 从 M0 Queue 的迁移路径；
- 备份和恢复。

## Alternatives Considered

- 继续扩展 PostgreSQL Queue；
- 自建状态机与 Timer；
- 立即无条件锁定 Temporal。

## Consequences

M1 增加验证工作，但降低 M2 架构返工。

## Rollback

若 Temporal 不满足，选择满足同一能力契约的后端，上层 API 不变。

## Validation

Spike 报告和自动故障注入全部通过后，更新 ADR 状态说明。

---

# ADR-0025：Context Policy 与 Pi 机制分工

## Context

Pi 已提供 Context Transform、Compaction、Skills、Extensions 和 Agent Loop。平台仍需知道业务 Scope、权限、Version 和 Replay。

## Decision

- 平台定义 Context Source、Scope、Priority、Budget、Sensitivity 和 Provenance；
- Pi 和插件执行消息转换、压缩、Skills/Tool 注入和 Agent Loop；
- 平台不重写通用 Context Engine；
- 插件不能绕过平台权限和 Test 隔离。

## Alternatives Considered

- 全部交给各 Node 自由拼 Prompt；
- 平台自建完整 Agent Harness；
- 直接保存所有消息并无限注入。

## Consequences

既复用 Pi，又保留平台可审计性。

## Validation

同一 Test Case 可冻结 Context Source 清单；未授权 Scope 不进入 Pi 输入。

---

# ADR-0026：Event 与 Attempt

## Decision

Execution Event 追加持久化；Retry 创建新 Attempt，不覆盖旧执行事实。

## Consequences

支持 SSE 续传、审计、故障分析和 Replay。

## Validation

断线续传、重复 Event、乱序保护和 Crash 恢复测试通过。

---

# ADR-0027：Thread 与 Incident

## Decision

Thread、Incident、Run 和 Node 为独立对象，避免全部塞入 Trigger Context。

## Consequences

支持一个 Incident 多次 Run、多线程协作和明确的 Channel 并发策略。

## Validation

同一 Thread 连续消息的 queue/serialize 策略可自动测试。

---

# ADR-0028：Tool、Skill、Subagent 和 Node 分离

## Decision

- Tool：可执行能力；
- Skill：按需加载的方法和 Runbook；
- Subagent：Agent 内部短生命周期委派；
- Workflow Node：显式、持久、可恢复的业务步骤。

## Validation

Golden Workflow 的两个分析 Agent 保持两个 Node；内部 Subagent 不改变 Definition。

---

# ADR-0029：Agent 预算和完成契约

## Decision

每个 Agent Node 必须设置预算和终止原因。`completed` 需要满足 Output Contract，不等于模型自然停止。

## Validation

无限 Tool Loop、空输出、无进展、超预算和未闭合 Tool Call 均产生明确失败。

---

# ADR-0030：Model Capability Registry

## Decision

Agent 发布前验证其需求与 Effective Model Capability 匹配，Run 保存能力快照。

## Validation

不支持 Tool Calling 或 Structured Output 的模型不能运行对应 Agent。

---

# ADR-0031：Artifact、Workspace、Sandbox 分离

## Decision

Artifact 是持久交付物；Workspace 是单次执行工作目录；Sandbox 是安全隔离边界。

## Validation

大 Tool 输出外部化；Workspace 生命周期结束后回收；未授权网络和文件访问被阻止。

---

# ADR-0032：Milestone 自动化验收

## Decision

每个阶段必须提供 `make verify-mN`，生成 JSON、HTML/Markdown、日志、事件和截图证据，并以退出码决定通过或阻断。

## Alternatives Considered

- 只用人工 Checklist；
- 只看单元测试；
- 只演示 Happy Path。

## Consequences

阶段完成更客观，但需要持续维护验收环境和 Fixture。

## Validation

Roadmap 中每个 Exit Criteria 都可追踪到自动 Test ID 或明确的人工抽样项。

---

# ADR-0033：Channel 接入前最小安全基线

## Decision

M3 前具备签名校验、重放保护、Allowlist、Thread Ownership、Allowed Responders、Artifact 安全下载和最小认证边界。

## Validation

伪造事件、重复事件、越权回复和危险 Artifact 测试被自动阻止。
