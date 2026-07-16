# Changelog v0.6 — Revised Baseline

- **日期**：2026-07-17
- **类型**：实施策略重构
- **取代**：早期 v0.6 Release Candidate Alignment Draft

## 1. 为什么仍使用 v0.6

早期 v0.6 尚未成为稳定实现基线，其核心执行策略导致 Coding Agent 过度投入测试、Evidence 和文档，而用户可见 Web 闭环未完成。

本次不是新增产品范围，而是修正 v0.6 本身，因此继续使用 v0.6，并明确为 Revised Baseline。

## 2. Added

- Architecture Complete / Delivery Strategy Reset；
- Vertical Slice First；
- Behavior Testing + Risk-Based Testing + Regression Testing；
- Functional Gate / Hardening Gate；
- 状态词 Planned / Implemented / Demonstrated / Verified / Stable；
- M0 单进程 Runtime 的阶段性允许；
- 一个 Codex Goal 一个用户结果；
- 低价值测试禁止清单；
- 轻量 Code Baseline 模板；
- 新的 M0 Web Run Goal 指令。

## 3. Changed

- M0 改为 Local Workflow Walking Skeleton；
- FlowGram 从 M0 硬门槛移动到 M1-A；
- PostgreSQL 持久化、Run History 和 Event 移到 M1；
- Worker、Attempt、Retry、Crash Recovery 移到 M2；
- Evidence Bundle 从所有阶段默认要求改为稳定发布或高风险门禁；
- 文档同步从每次修改改为决策增量；
- 自动验收从大矩阵改为按风险分层；
- Codex 不再在同一 Goal 自动推进多个里程碑。

## 4. Superseded

- “M0 必须完成 FlowGram 才能结束”；
- “M0 必须独立 Worker、Queue、Lease 和 Crash Recovery”；
- “先完成全量 Code Conformance Report 再修改代码”；
- “每个 Requirement 必须生成 Evidence”；
- “连续三次 clean verify 才能开始下一功能”；
- “所有代码严格 test-first”；
- “同一 Goal 通过 M0 后继续 M1-A”。

## 5. Reaffirmed

- 完整平台产品目标不变；
- JSON Definition 是事实来源；
- Pi Agent 通过 Adapter 接入；
- FlowGram 不是 Runtime；
- Coze 仅作参考；
- 完整 Builder 在 M4；
- Human、Tool、Channel、Evidence、Memory 和 Security 都是正式 Roadmap 能力；
- 生产写操作必须受 Policy、Approval、Idempotency 和 Audit 约束。

## 6. Immediate Next Goal

完成 M0 Functional Gate：

```text
start
→ open Web
→ view workflow
→ enter prompt
→ run
→ view status
→ view output
```

完成后停止并 Review，不自动继续 M1。
