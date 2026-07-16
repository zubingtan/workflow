# Feasibility Analysis：完整平台目标与增量交付

- **版本**：v0.6
- **状态**：Reviewed
- **日期**：2026-07-17

## 1. 分析问题

当前真正的矛盾不是“是否设计完整平台”，而是：

> 如何在保留完整架构和长期能力的前提下，避免 Coding Agent 因过度 TDD、验收工程和文档治理而无法交付最小用户功能。

## 2. 已知事实

- 项目目标是完整 Workflow Platform，不是一次性 Demo；
- 首个可见 Web 闭环仍未稳定交付；
- 旧 v0.6 指令同时要求代码审计、FlowGram、Durable Runtime、事件、故障恢复、完整测试和文档；
- Coding Agent 倾向优先处理可枚举、可检查的任务，例如测试和矩阵；
- 复杂 Goal 会让 Agent 失去用户价值排序；
- 当前环境无法读取 `m0-v0.1.0` 代码，因此文档不能断言实现进度。

## 3. 方案比较

### 方案 A：Release Engineering First

先完成：

- 全量 Requirement Matrix；
- strict TDD；
- Worker Crash；
- Evidence Bundle；
- 连续稳定验证；
- 全文档同步。

**优点**

- 验收严格；
- 适合成熟系统准备发布。

**缺点**

- 产品闭环出现过晚；
- 大量测试针对尚未稳定的设计；
- 容易产生低价值测试；
- Coding Agent 被流程而非用户结果驱动。

**结论**：当前阶段不采用。

### 方案 B：Demo Only

只写页面和一次模型调用，不设计长期架构。

**优点**

- 快速可见；
- 代码简单。

**缺点**

- 后续重构成本高；
- Workflow、Run、Agent 和 Definition 可能混在一起；
- 不适合目标平台。

**结论**：不采用。

### 方案 C：Complete Architecture + Vertical Slices

完整定义领域、边界和 Roadmap；每次只实现一个真实纵向切片，使用风险驱动测试。

**优点**

- 保留平台方向；
- 快速形成用户反馈；
- 真实集成问题更早暴露；
- 测试对应稳定行为；
- Coding Agent Goal 更清晰。

**缺点**

- 需要接受阶段性单进程、内存状态等简化；
- 必须维护演进边界，避免 Demo 代码侵入核心；
- Hardening 需要后续明确补齐。

**结论**：采用。

## 4. 技术可行性

完整平台可以通过阶段演进实现：

```text
M0 Single-process Run
→ M1 Persistent Observable Run
→ M2 Durable Run
→ M3 Oncall Integrations
→ M4 Builder/Test
→ M5 Team/Memory/Production
```

关键是先稳定 Port 和业务语义：

- WorkflowDefinition；
- RunService；
- StateRepository；
- AgentRuntimePort；
- VisualProjectionPort；
- Event/Status projection。

这些边界足以支持演进，不需要第一天实现所有后端。

## 5. FlowGram 可行性

FlowGram 官方将其定位为工作流开发框架和工具集，提供 Canvas、Form、Variable 和 Materials，而不是开箱即用的完整 Workflow Platform。因此使用 Adapter 接入、保留自有 Definition 和 Runtime 是合理的。

M1-A 接入优于 M0：

- M0 先稳定 Definition/Run 数据流；
- M1-A 直接投影真实数据；
- 避免画布 mock 成为第二套系统；
- 仍然早于 M4 Builder，能尽早验证框架。

## 6. Agent 执行可行性

Coding Agent 更适合：

- 一个清晰用户结果；
- 有具体入口和停止条件；
- 较小的文件范围；
- 明确禁止无关重构；
- 只运行相关测试；
- 完成后停止 Review。

不适合：

- 一个 Prompt 同时推进多个里程碑；
- 先创建所有未来测试；
- 需要自行解释大量模糊文档；
- 既做架构迁移又做产品 UI 又做 Release。

## 7. 风险矩阵

| 风险 | 影响 | 控制 |
|---|---|---|
| M0 简化代码变成永久架构 | 高 | Port/Repository/Adapter 边界 |
| Hardening 永远被推迟 | 高 | Roadmap 双门和进入高风险阶段前置条件 |
| FlowGram 再次阻塞交付 | 中 | M1-A 只读纵向切片，不做 Builder |
| 测试不足导致回归 | 中 | happy-path smoke + Bug regression + 高风险 test-first |
| 文档和代码再次脱节 | 中 | 切片结束更新 README/Roadmap，关键决策更新 ADR |
| Agent 做无关重构 | 中 | Goal 限定范围、停止条件和禁止项 |
| 外部工具过早开放 | 高 | M3 Tool Gateway/Approval/Audit |
| Memory 错误传播 | 高 | M5 Reviewed Memory、Shadow、Quarantine |

## 8. Go / No-go

### GO

- 完整平台架构；
- M0 Functional Gate；
- M1-A FlowGram read-only；
- 风险驱动测试；
- 里程碑双门；
- 单 Goal 单用户结果。

### NO-GO

- 当前 Goal 建设完整 Release Engineering；
- 所有代码 strict TDD；
- 文件存在性和文档存在性 UT；
- 同一 Goal 自动从 M0 推进到 M1；
- 在 M0 预建 M2/M3/M4 抽象；
- 以测试数量证明进度。

## 9. 最终建议

先完成 M0 Web Run Functional Gate。完成后进行一次短 Review，再给 Codex 一个新的 M1-A Goal。

平台设计保持完整，但执行必须保持有界。
