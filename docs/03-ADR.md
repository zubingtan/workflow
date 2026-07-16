# ADR：Oncall Workflow Platform 当前架构决策

- **版本**：v0.6
- **状态**：Active Decision Baseline
- **日期**：2026-07-17

本文件是当前决策索引。进入稳定开发后，重要决策可以拆分成独立 ADR；本汇总保留统一编号和状态。

## 1. 状态

- **Accepted**：当前实现与计划必须遵守；
- **Proposed**：需要 Spike 或 Review；
- **Deferred**：已识别但不在当前阶段；
- **Superseded**：被新决策替代；
- **Rejected**：当前不得采用。

## 2. 核心决策

| ADR | 决策 | 状态 | 阶段 |
|---|---|---|---|
| 0001 | 产品定位为可信 Oncall Workflow Platform | Accepted | 全阶段 |
| 0002 | 首阶段称为 M0 Walking Skeleton | Accepted | M0 |
| 0003 | JSON Workflow Definition 是业务事实来源 | Accepted | M0+ |
| 0004 | 可执行 Family 为 Input/Process/Logic/Output | Accepted | 全阶段 |
| 0005 | Control/Data/Error/Runtime Context 分离 | Accepted | 全阶段 |
| 0006 | Workflow、Agent Definition、Run 分开建模 | Accepted | 全阶段 |
| 0007 | Pi Agent 是首个 Agent Runtime，通过 Adapter 接入 | Accepted | M0+ |
| 0008 | Provider Secret 不属于 Workflow Definition | Accepted | M0+ |
| 0009 | Definition Version 最终不可变 | Accepted | M1+ |
| 0010 | FlowGram 是 Canvas Framework，不是 Runtime | Accepted | M1+ |
| 0011 | Authoring Model 与 Runtime WorkflowIR 分离 | Accepted | M1+ |
| 0012 | FlowGram 完整 Authoring 延后到 M4 | Accepted | M4 |
| 0013 | PostgreSQL 保存结构化状态，Artifact Store 保存大对象 | Accepted | M1+ |
| 0014 | Retry 创建独立 Attempt，不覆盖历史 | Accepted | M2+ |
| 0015 | ExecutionEvent 追加持久化 | Accepted | M1+ |
| 0016 | Human Interaction 使同一 Node 进入 waiting | Accepted | M2+ |
| 0017 | Loop 必须有退出条件、上限和无进展保护 | Accepted | M3+ |
| 0018 | Feishu 通过 Channel Adapter 接入 | Accepted | M3 |
| 0019 | Tool Gateway 是生产 Tool 统一边界 | Accepted | M3+ |
| 0020 | Tool、Skill、Subagent、Workflow Node 分离 | Accepted | 全阶段 |
| 0021 | Test Mode 是一等产品模式 | Accepted | M4 |
| 0022 | Memory 使用 Episode、Review、Quarantine、Expiry | Accepted | M5 |
| 0023 | M5 前不支持任意代码执行 | Accepted | M0–M4 |
| 0024 | 不支持实时多人协同画布 | Accepted | 全阶段 |
| 0025 | Docs-as-Code，活跃目录只有一个现行版本 | Accepted | 立即 |
| 0026 | Coze Studio 仅作参考，不整体 Fork | Accepted | 全阶段 |
| 0027 | Agent 生成代码必须人工 Review | Accepted | M3+ |
| 0028 | 一个外部事件只创建一个 Workflow Run | Accepted | M3+ |
| 0029 | Thread、Incident、Run、Node 不混用 | Accepted | M1+ |
| 0030 | Durable Backend 通过 M2 Spike 决定 | Proposed | M2 |

## 3. v0.6 实施策略决策

### ADR-0046：完整架构与增量实现分离

**Decision**

文档完整定义目标平台，但当前实现只建设支撑下一个纵向产品切片的最小能力。

**Reason**

把完整架构全部转化为当前实现要求，会导致过度抽象、过度测试和交付停滞。

**Consequence**

- Design Doc 可以描述 M5；
- Codex Goal 只能覆盖一个明确用户结果；
- 未进入当前切片的能力保持 Planned，不创建占位实现。

### ADR-0047：采用 Vertical Slice First

**Decision**

每个实现 Goal 必须贯穿 UI、API、Domain、Runtime 和结果展示，形成真实可运行行为。

**Rejected Alternative**

按数据库、测试框架、事件系统、文档系统等横向层逐一建设。

**Consequence**

优先暴露真实集成问题，避免底层组件很多但产品不可使用。

### ADR-0048：不强制严格 TDD

**Decision**

工程采用 Behavior Testing + Risk-Based Testing + Regression Testing，不要求所有代码 test-first。

以下场景适合 test-first：

- Compiler/parser；
- 状态机；
- migration；
- 安全边界；
- 已复现 Bug。

以下场景允许 implementation-first：

- UI composition；
- 新框架 Spike；
- API wiring；
- 当前纵向切片的首次打通。

**Consequence**

测试质量用风险覆盖和缺陷保护衡量，不用测试数量或覆盖率衡量。

### ADR-0049：禁止低价值结构测试

**Decision**

不得把以下测试作为里程碑工作：

- 文件/目录/文档存在性；
- 简单 DTO、getter、常量；
- 框架默认行为；
- 尚未实现接口；
- 为覆盖率而构造的测试；
- 对不稳定 UI DOM 的大规模快照。

只有当文件本身是发布产物契约时，存在性检查才有价值，例如 migration manifest 或生成包清单。

### ADR-0050：里程碑采用 Functional Gate 与 Hardening Gate

**Decision**

每个里程碑拆成：

- Functional Gate：用户核心任务真实工作；
- Hardening Gate：关键失败、安全、恢复和回归达到该阶段要求。

**Consequence**

Functional Gate 不被完整发布工程阻塞；但进入生产写操作、外部 Channel 和稳定发布前必须满足相应 Hardening Gate。

### ADR-0051：一个 Codex Goal 只交付一个用户结果

**Decision**

禁止在一个 Goal 中同时要求代码审计、全量文档、完整测试平台、多个里程碑和生产发布。

Goal 必须包含：

- 一个用户可见结果；
- 明确范围；
- 明确停止条件；
- 最少必要测试；
- 最少必要文档更新。

### ADR-0052：M0 允许单进程 Runtime

**Decision**

M0 可以在 App 进程内执行 Workflow，但必须通过 RunService、AgentRuntimePort 和 StateRepository 保留可替换边界。

**Supersedes**

此前“第一天必须独立异步 Worker、Queue、Lease、Crash Recovery”的实现要求。

**Reason**

这些是 M2 Durable Runtime 的能力，不应阻塞最小 Web 闭环。

### ADR-0053：FlowGram 移至 M1-A

**Decision**

M0 可使用简单结构展示 Workflow。FlowGram 在 M1-A 作为第一个正式视觉切片接入。

**Supersedes**

此前“FlowGram 是 M0 退出硬门槛”。

**Reason**

必须先确认 Definition、Run API 和 Agent 执行闭环，再把真实数据投影到 Canvas。FlowGram 仍然早于完整 Builder，并未被取消。

### ADR-0054：文档按决策增量更新

**Decision**

实现过程中只在产品范围、领域模型、模块边界、公开 API 或关键技术决策变化时更新核心文档。普通实现细节在切片完成后统一同步。

**Consequence**

不再要求 Coding Agent 每次修改同步所有文档、矩阵和报告。

### ADR-0055：Evidence Bundle 只用于稳定发布或高风险门禁

**Decision**

普通功能切片不强制生成 Evidence Bundle。稳定 Release、Durable Recovery、生产 Tool、Channel 和 Security Gate 可以要求证据包。

**Supersedes**

此前“每个 Milestone 从第一天生成完整 Evidence Bundle”。

## 4. 被本版明确 Supersede 的旧决策

| 旧决策 | 新决策 |
|---|---|
| M0 必须 FlowGram | M0 简单展示；M1-A 正式 FlowGram |
| M0 必须独立 Worker/Lease/Recovery | M0 单进程可接受；M2 Durable Runtime |
| M0 必须连续多次 clean verification | M0 一个可复现 smoke；稳定发布再做重复稳定性验证 |
| 每个 Requirement 都需要 Evidence | 当前切片只保留最小行为验证 |
| 先 Code Conformance Matrix 再写代码 | 先做轻量基线，立即修复产品阻塞 |
| M0 完成后同一 Goal 自动推进 M1 | 一个 Goal 一个结果，完成后停止 Review |

## 5. Proposed / Deferred

- Durable Backend：PostgreSQL Queue、Temporal 或其他方案；
- M2 Attempt 与 Event 的事务模型；
- M3 Feishu 长连接具体部署；
- M4 Authoring ChangeSet 协议；
- M5 Memory 检索和评估策略；
- M5 Sandbox 技术选型。

## 6. 冲突处理

发生冲突时：

1. 不静默修改 Accepted ADR；
2. 写出冲突和当前代码事实；
3. 若旧决策导致明显交付失败，使用 Superseded；
4. 新决策说明原因、代价和迁移；
5. 不为了匹配现有代码而放弃产品原则；
6. 不为了文档完整而要求当前代码实现未来阶段。
