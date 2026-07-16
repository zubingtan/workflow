# Documentation Governance：完整架构、当前事实与实现节奏

- **版本**：v0.6
- **状态**：Active Governance Baseline
- **日期**：2026-07-17

## 1. 目标

文档体系需要同时支持：

- 完整产品和架构设计；
- 当前阶段清晰执行；
- 代码事实可信；
- Coding Agent 不被大量文档阻塞；
- 历史决策可追踪；
- 当前活跃目录只有一个现行版本。

## 2. 文档职责

| 文档 | 回答的问题 | 更新触发 |
|---|---|---|
| PRD | 为什么做、给谁、完整产品范围是什么 | 产品目标、范围或用户价值变化 |
| Design Doc | 系统如何分层和演进 | 模块边界、领域模型、公开接口变化 |
| ADR | 为什么选择或替换一个重要决策 | 新关键决策、旧决策被 Supersede |
| Roadmap | 先做什么、何时进入下一风险层 | 里程碑范围或顺序变化 |
| Testing UX | 产品测试体验和工程测试原则 | 测试策略或 Test Mode 变化 |
| Acceptance | Functional/Hardening Gate | 阶段门槛变化 |
| Code Baseline | 当前代码实际做到什么 | 完成一个功能切片后 |
| Changelog | 本版文档和决策改了什么 | 文档版本交付 |
| Validation Report | 文档集是否一致 | 每次打包 |

## 3. 三类事实必须分开

### Product Intent

来自 PRD 和 Roadmap，表示想要什么。

### Architecture Decision

来自 ADR 和 Design Doc，表示选择什么边界和方向。

### Implementation Fact

来自代码、运行结果和关键测试，表示当前真实有什么。

不得使用以下替代 Implementation Fact：

- tag 名；
- 文件名；
- TODO；
- 测试数量；
- 文档声明；
- Agent 口头总结。

## 4. 当前状态词

只使用：

- **Planned**
- **Implemented**
- **Demonstrated**
- **Verified**
- **Stable**
- **Blocked**
- **Superseded**

定义：

- Implemented：代码存在；
- Demonstrated：真实用户路径成功；
- Verified：关键自动测试成功；
- Stable：对应 Hardening Gate 成功。

## 5. Coding Agent 阅读集

Coding Agent 不应每次阅读全部文档。

### M0 Goal

必须阅读：

1. `README.md`
2. `04-ROADMAP.md` 的 M0
3. `CODEX-NEXT-INSTRUCTION.md`

需要架构细节时再读：

- `02-DESIGN-DOC.md`
- `03-ADR.md`

### M1 FlowGram Goal

读取：

- `02-DESIGN-DOC.md`
- `10-VISUAL-WORKFLOW-ARCHITECTURE.md`
- `04-ROADMAP.md` M1-A
- 当前 Goal 指令

### M2 Durable Goal

读取：

- `02-DESIGN-DOC.md` Runtime/Event
- `03-ADR.md`
- `04-ROADMAP.md` M2
- `09-MILESTONE-AUTOMATED-ACCEPTANCE.md`

### M3+ Goal

按 Tool、Interaction、Channel、Memory 的边界选择文档，不默认全读。

## 6. 实现期间的文档规则

实现过程中，只在以下变化发生时立即更新文档：

- 产品范围；
- 用户可见行为；
- 领域模型；
- 模块边界；
- 公开 API；
- 数据持久化语义；
- 安全模型；
- 关键技术选型。

不要求为以下修改同步所有文档：

- CSS；
- 内部函数重命名；
- 局部重构；
- 小 Bug；
- 测试 fixture；
- 日志格式微调。

完成切片后更新：

- README 当前能力；
- Roadmap 状态；
- 必要的 Design/ADR；
- Changelog。

## 7. 文档不得成为实现前置仪式

禁止要求 Coding Agent 在写产品代码之前：

- 填写全量 Requirement Matrix；
- 为每个文件建立 Evidence；
- 重写全部文档；
- 生成大规模架构图；
- 证明所有未来阶段；
- 为尚未实现行为写完整测试规范。

允许的前置工作应是轻量且直接帮助实现：

- 读取当前启动方式；
- 找到 UI/API/Runtime 入口；
- 运行现有 happy path；
- 识别当前阻塞；
- 记录一个关键架构偏差。

## 8. ADR 规则

需要 ADR：

- 技术栈或基础设施选型；
- 持久化语义；
- 公开领域模型；
- 安全边界；
- Runtime/Canvas/Channel 集成方式；
- 旧决策被替换。

不需要 ADR：

- 普通库函数；
- CSS；
- 简单组件；
- 局部文件组织；
- 可逆的实现细节。

## 9. Release Artifact

文档 ZIP 包包含：

- 当前全部 Markdown；
- `MANIFEST.json`；
- `SHA256SUMS`；
- `apply-v0.6.sh`；
- `VALIDATION-REPORT.md`。

活跃目录不混入 v0.4/v0.5 或早期 v0.6 草案。

## 10. 版本规则

本包仍称 v0.6，但明确：

> 本版是 v0.6 Revised Baseline，取代之前的 v0.6 Release Candidate Alignment Draft。

原因是前一草案的实施策略存在系统性错误，需要在进入下一版本前修正当前基线。

## 11. 文档 Review Checklist

- 当前 Goal 是否只有一个用户结果？
- 是否区分长期架构和当前实现？
- 是否有低价值测试要求？
- 是否把 Hardening 当成功能前置？
- FlowGram、Pi、Channel 边界是否一致？
- Planned 能力是否被写成当前事实？
- Roadmap 与 Codex 指令是否一致？
- 文档是否要求 Agent 重复更新所有文件？
