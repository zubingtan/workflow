# 基于 Pi Agent 的 Oncall Workflow Platform

- **文档集版本**：v0.6
- **状态**：Architecture Complete / Delivery Strategy Reset
- **更新日期**：2026-07-17
- **代码参考基线**：`m0-v0.1.0`（当前文档环境未能读取代码内容）
- **当前执行目标**：完成 M0 Functional Gate——可启动、可打开 Web、可运行最小 Workflow、可看到结果
- **下一阶段**：M1-A——基于 FlowGram 的 Workflow Board 与 Run 状态集成

## 1. 项目一句话

本项目是一个面向小团队的可信 Oncall Workflow Platform：以版本化 Workflow 组织 Agent、Tool、Human Interaction、Evidence、Test、Channel 和 Memory，使一次排障过程可执行、可观察、可恢复、可验证并可审计。

平台的最小价值单位不是一次聊天，而是一次：

> 有明确输入、执行路径、节点状态、证据、结果和历史的 Workflow Run。

## 2. v0.6 为什么重做

此前的 v0.6 草案把“完整平台架构”“当前功能实现”“生产级加固”和“自动验收体系”压进同一个 Goal，导致 Coding Agent 优先建设测试矩阵、Evidence、恢复脚本和文档，而用户仍看不到完整 Web 闭环。

本版保留完整平台目标，但修改施工方式：

```text
完整架构作为方向
  → 每次只交付一个纵向产品切片
  → 先让真实行为工作
  → 再保护核心契约
  → 再做可靠性加固
  → 最后完成发布级验收
```

这不是把平台降级为 Demo，而是把“架构设计完整”和“实现一次到位”分开。

## 3. 统一实施原则

### 3.1 Architecture Complete

长期架构仍包含：

- Workflow Definition / Version / Compiler / WorkflowIR；
- FlowGram Visual Adapter；
- WorkflowRun / NodeRun / Attempt / ExecutionEvent；
- Agent Runtime Adapter；
- Tool Gateway / Policy / Approval；
- Human Interaction；
- Durable Execution；
- Test / Replay / Compare / Publish Gate；
- Evidence / Artifact / Audit；
- Feishu Channel Adapter；
- Reviewed Memory；
- Workspace / RBAC / Sandbox。

### 3.2 Vertical Slice First

每个 Goal 必须对应一个用户可感知、可以运行的纵向能力。当前第一条路径是：

```text
打开 Web
  → 看见 Input / Agent / Output
  → 输入 Prompt
  → 点击 Run
  → Agent 执行
  → 页面显示结果
```

不得在这条路径完成前，把主要精力投入未来阶段的抽象、测试基础设施或发布工程。

### 3.3 Behavior Testing

不采用强制 test-first TDD。测试保护真实行为、领域契约和已发现缺陷，不测试施工细节。

禁止的低价值测试包括：

- 源文件、目录或文档是否存在；
- 简单 DTO、getter、常量和框架默认行为；
- 尚未实现的未来接口；
- 只为覆盖率而写的测试；
- 用测试固定一个仍在探索中的 UI 结构。

### 3.4 Two Gates

每个里程碑拆成两个门：

- **Functional Gate**：用户可完成核心任务，产品切片真实可运行；
- **Hardening Gate**：关键失败、恢复、安全和回归达到该阶段要求。

Functional Gate 优先交付；Hardening Gate 在进入高风险外部集成或稳定发布前完成。

## 4. 当前阶段

### M0：Local Workflow Walking Skeleton

当前只要求完成 Functional Gate：

- 本地一键启动；
- Web 页面可打开；
- 展示 Input / Agent / Output；
- JSON Definition 驱动最小 Workflow；
- 用户输入 Prompt 并执行；
- Fake Provider 默认工作；
- 页面展示状态和最终结果；
- README 步骤可以复现；
- 一个核心集成测试或 smoke test 保护 happy path。

M0 当前不要求：

- FlowGram；
- 独立 Worker 与 lease；
- Crash Recovery；
- Attempt / ExecutionEvent；
- SSE Resume；
- Evidence Bundle；
- 全量 Requirement Matrix；
- 连续多次 clean verification；
- 完整异常组合。

这些能力没有被取消，而是放到后续明确阶段。

## 5. Roadmap 摘要

| 阶段 | 核心交付 |
|---|---|
| M0 | 本地 Web + JSON Workflow + Agent Run + Output |
| M1 | FlowGram Workflow Board、持久化 Run、事件与可观察性 |
| M2 | Durable Execution、Attempt、Retry、Cancel、Crash Recovery |
| M3 | Oncall Golden Workflow、Tool、Human、Feishu、Evidence |
| M4 | Workflow Builder、Test Studio、Replay、Publish Gate |
| M5 | Team Security、Reviewed Memory、Sandbox、Production Hardening |

详见 [04-ROADMAP.md](./04-ROADMAP.md)。

## 6. 关键架构边界

1. JSON Workflow Definition 是业务事实来源。
2. FlowGram 是工作流开发框架和可视化适配层，不是生产 Runtime。
3. Pi Agent 是 Agent Runtime；平台不重写其 Agent Loop。
4. Workflow、Agent Definition、Run、NodeRun、Thread、Incident 必须分开。
5. UI 不直接调用 Pi Runtime。
6. Secret 不进入 Workflow Definition 或前端。
7. Tool、Skill、Subagent 和 Workflow Node 是不同概念。
8. Memory 必须可追溯、可撤销、可过期，先 Shadow 再启用。
9. 外部写操作必须晚于 Policy、Approval、Idempotency 和 Audit。
10. 不支持实时多人协同编辑；使用版本、权限和审计协作。

## 7. 文档导航

1. [01-PRD.md](./01-PRD.md) — 产品问题、目标、用户与完整能力范围
2. [02-DESIGN-DOC.md](./02-DESIGN-DOC.md) — 完整架构、领域模型与演进路径
3. [03-ADR.md](./03-ADR.md) — 当前有效决策与本版 Supersede
4. [04-ROADMAP.md](./04-ROADMAP.md) — M0–M5 纵向切片和双门策略
5. [05-DOCUMENTATION-GOVERNANCE.md](./05-DOCUMENTATION-GOVERNANCE.md) — 文档更新和 Agent 阅读规则
6. [06-MEMORY-DESIGN.md](./06-MEMORY-DESIGN.md) — Reviewed Memory 设计
7. [07-WORKFLOW-TESTING-UX.md](./07-WORKFLOW-TESTING-UX.md) — 产品 Test Mode 与工程测试策略
8. [08-FEASIBILITY-ANALYSIS.md](./08-FEASIBILITY-ANALYSIS.md) — 范围、顺序与风险 Review
9. [09-MILESTONE-AUTOMATED-ACCEPTANCE.md](./09-MILESTONE-AUTOMATED-ACCEPTANCE.md) — Functional/Hardening Gate
10. [10-VISUAL-WORKFLOW-ARCHITECTURE.md](./10-VISUAL-WORKFLOW-ARCHITECTURE.md) — FlowGram 接入架构
11. [11-COZE-FLOWGRAM-REFERENCE.md](./11-COZE-FLOWGRAM-REFERENCE.md) — 外部参考边界
12. [12-REVIEW-AND-OPEN-QUESTIONS.md](./12-REVIEW-AND-OPEN-QUESTIONS.md) — 本轮自行 Review 与开放问题
13. [CODE-CONFORMANCE-REPORT.md](./CODE-CONFORMANCE-REPORT.md) — 轻量代码基线模板
14. [CODEX-NEXT-INSTRUCTION.md](./CODEX-NEXT-INSTRUCTION.md) — 当前唯一 Codex Goal
15. [CHANGELOG-v0.6.md](./CHANGELOG-v0.6.md) — 本次重写变更
16. [VALIDATION-REPORT.md](./VALIDATION-REPORT.md) — 文档一致性检查

## 8. 当前 Codex Goal

当前 Goal 只完成 M0 Web Run 纵向闭环。完成后停止，不自动进入 M1，不扩展发布级测试和文档系统。

详细指令见 [CODEX-NEXT-INSTRUCTION.md](./CODEX-NEXT-INSTRUCTION.md)。

## 9. 当前代码事实限制

本次文档重写环境无法访问 `zubingtan/workflow` 的 tag 归档，因此不能可信声明 `m0-v0.1.0` 已实现哪些能力。

本包对代码状态只使用：

- `Unknown`：尚未检查；
- `Implemented`：本地代码存在；
- `Demonstrated`：真实运行成功；
- `Verified`：关键自动测试通过；
- `Stable`：对应 Hardening Gate 通过。

不得用 tag 名、文件名、测试数量或文档声明替代产品行为。
