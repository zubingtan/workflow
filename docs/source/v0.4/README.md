# 基于 Pi Agent 的 Oncall Workflow Platform

- **文档集版本**：v0.4
- **状态**：Active Development Baseline
- **更新日期**：2026-07-14
- **当前里程碑**：M0 — Local Executable Workflow Skeleton
- **下一业务验证节点**：M3 — Oncall Golden Workflow Validation

## 1. 项目一句话

本项目是一个面向小团队的、可自定义 Agent 与 Workflow 的可信 Oncall Workflow Platform。

它不是通用聊天 App，也不是仅把模型 API 包装成节点图。平台的最小价值单位是一次：

> 可配置、可执行、可观察、可暂停、可恢复、可测试、结果可消费且可审计的 Workflow Run。

## 2. 核心架构原则

> **Workflow 负责确定性编排，Agent 负责节点内部的智能执行。**

平台与 Pi Agent 的职责边界：

- 平台定义 Workflow、版本、Run、权限、上下文策略、工具边界、审计和测试；
- Pi Agent 负责 Agent Loop、消息与工具调用、上下文转换、事件输出及可复用扩展能力；
- Pi Skills、Extensions 和 Packages 优先复用，不在平台重复实现通用 Agent Harness；
- 平台通过适配层使用 Pi，不把 Pi Session、内部消息格式或插件生命周期暴露成平台公共协议。

Context Engineering 的统一口径：

> **Pi Agent 实现上下文处理机制；平台定义上下文的业务语义、来源、作用域、预算、权限、版本和审计。**

## 3. 文档导航

1. [PRD：产品问题、目标、用户、范围和成功指标](./01-PRD.md)
2. [Design Doc：总体架构、职责边界和执行模型](./02-DESIGN-DOC.md)
3. [ADR：当前有效架构决策](./03-ADR.md)
4. [Roadmap：M0–M5 风险顺序、退出门槛和自动化验收](./04-ROADMAP.md)
5. [Documentation Governance：长期文档治理](./05-DOCUMENTATION-GOVERNANCE.md)
6. [Memory Design：可追溯、可撤销的长期 Memory](./06-MEMORY-DESIGN.md)
7. [Workflow Testing UX：测试、回归和发布门禁](./07-WORKFLOW-TESTING-UX.md)
8. [Feasibility Analysis：全文一致性与可行性分析](./08-FEASIBILITY-ANALYSIS.md)
9. [Milestone Automated Acceptance：阶段自动化验收规范](./09-MILESTONE-AUTOMATED-ACCEPTANCE.md)

## 4. M0 最小闭环

```text
clone repository
  → copy .env.example
  → configure an OpenAI-compatible model provider
  → make doctor
  → make up
  → open Web
  → run JSON-defined Input → Pi Agent → Markdown Output
  → inspect Workflow Run and Node Run
  → make verify-m0
```

M0 只实现：

- `input.prompt`
- `process.agent`
- `output.markdown`
- JSON Workflow Definition
- 不可变 Definition Version
- 异步持久化 Run
- 只读 Workflow Board
- 成功、失败、Worker 重启和历史持久化

## 5. 统一开发与验收命令

文档定义的是稳定的用户契约，具体脚本语言由实现决定。

```bash
make setup
make doctor
make up
make down
make logs
make smoke-test

make verify-m0
make verify-m1
make verify-m2
make verify-m3
make verify-m4
make verify-m5

make support-bundle
```

每个 `verify-mN` 必须：

1. 从可重建环境开始；
2. 自动准备测试数据；
3. 执行成功路径与故障路径；
4. 自动判断 Pass / Fail；
5. 生成机器可读 JSON 和人可读 HTML/Markdown 报告；
6. 保存日志、事件、截图和关键 Run 作为验收证据；
7. 返回非零退出码阻断 CI 或发布。

## 6. 当前强制决策

- JSON Workflow Definition 是事实来源；M0 Board 只读。
- Workflow、Agent Definition、Workflow Run、Node Run、Thread、Incident 分开建模。
- 每个 Run 绑定不可变 Definition Version。
- Pi Agent 是当前唯一支持的 Agent Runtime。
- 平台复用 Pi 的 Agent Harness、Skills、Extensions 和 Context Hooks，不重复造通用 Runtime。
- API 只创建 Run；Worker 异步执行并持久化状态。
- M0 使用 PostgreSQL Queue；M2 前必须通过 Durable Execution 选型验证。
- Provider Secret 不进入浏览器、Workflow JSON、Run 数据或普通日志。
- M0 只实现三种节点。
- Agent 主动 Human Interaction 从 M2 开始，以持久化 `waiting` 状态表达。
- Tool 与 Skill 分离；Subagent 仅用于 Agent 节点内部的受控委派。
- Memory 先保存 immutable episode，再进入自动审核和受控召回。
- Test Case、故障注入和自动化验收是产品的一等能力。
- 未通过当前 Milestone 的自动化验收，不得宣布阶段完成。

## 7. 文档权威性

发生冲突时：

- 产品目标和用户价值：以 PRD 为准；
- 已接受的技术选择：以 ADR 为准；
- 模块边界和执行语义：以 Design Doc 为准；
- 阶段范围和退出门槛：以 Roadmap 为准；
- 自动化验收细则：以 Milestone Automated Acceptance 为准；
- Memory：以 Memory Design 为准；
- Workflow 测试体验：以 Workflow Testing UX 为准；
- 文档维护方式：以 Documentation Governance 为准。

研究报告和外部项目只能作为证据，不能自动成为项目决策。

## 8. Coding Agent 最小阅读集

- M0 通用任务：README、Roadmap M0、Design Doc M0 章节、相关 ADR、M0 验收规范。
- Workflow Runtime：Design Doc 的 Workflow、Run、事件和恢复章节。
- Pi Runtime：Design Doc 的 Pi 集成与 Context Policy 章节。
- Human Interaction：Design Doc、Roadmap M2、Testing UX。
- Tool / Skill / Subagent：Design Doc 对应章节和 ADR。
- Memory：Memory Design、Roadmap M3、Testing UX。
- Web / Builder：PRD 用户体验、Roadmap M4、Testing UX。
- 文档或架构修改：ADR、Documentation Governance、Feasibility Analysis。

默认不读取 `archive/`、过期研究或未接受 Proposal。
