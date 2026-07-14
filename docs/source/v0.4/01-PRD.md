# PRD：基于 Pi Agent 的 Oncall Workflow Platform

- **版本**：v0.4
- **状态**：Active Development Baseline
- **日期**：2026-07-14
- **当前里程碑**：M0
- **关联文档**：[Design Doc](./02-DESIGN-DOC.md) · [ADR](./03-ADR.md) · [Roadmap](./04-ROADMAP.md) · [Feasibility Analysis](./08-FEASIBILITY-ANALYSIS.md)

---

## 1. 执行摘要

本项目要构建的是：

> **面向小团队的、可自定义 Agent 与 Workflow 的可信 Oncall Workflow Platform。**

平台把告警、上下文收集、多个专业 Agent、人工补充信息、只读工具、证据、结果输出、测试和经验沉淀组织成可版本化的 Workflow。

平台不是以“Agent 可以做多少事”为第一目标，而是以以下能力为核心：

- 过程可定义；
- 执行可追踪；
- 失败可解释；
- 等待可恢复；
- 结果有证据；
- 权限有边界；
- 修改可回归；
- 历史可审计。

## 2. 背景与问题

小团队 Oncall 通常分散在聊天、监控、日志、代码仓库、Runbook、临时脚本和个人经验中，导致：

- 重复步骤无法沉淀为可复用流程；
- 分析过程和证据没有统一 Run；
- Agent 缺信息时容易猜测或在流程外提问；
- 服务重启、超时或工具失败后难以解释；
- 模型、工具、权限和 Secret 的边界不清晰；
- 结论与证据脱节；
- 经验会过期、冲突或被错误摘要污染；
- Workflow 修改后缺少可复现回归测试；
- UI 容易先于执行可靠性扩张。

核心问题：

> 如何让小团队以可控、可审计、可恢复和可验证的方式，把 Oncall 中确定性的流程和 Agent 的推理能力组合起来。

## 3. 产品目标

### 3.1 长期目标

- 将重复 Oncall 处理步骤转化为版本化 Workflow；
- 支持不同职责的专业 Agent；
- 支持 Agent 在缺信息时主动向 Human 提问；
- 支持只读 Tool、Evidence、Artifact 和最终报告；
- 支持测试、回放、版本比较和发布门禁；
- 支持可追溯、可撤销、可过期的长期 Memory；
- 支持小团队在明确权限和隔离下安全使用。

### 3.2 当前目标

M0 只证明最小执行骨架：

```text
Input → Pi Agent → Markdown Output
```

成功标准不是界面丰富，而是：

- 干净环境可部署；
- Definition 可验证和版本化；
- Run 异步且持久化；
- 成功和失败均可解释；
- Worker 重启后历史不丢失；
- 自动化验收可重复执行。

## 4. 非目标

当前项目不是：

- 通用聊天 App；
- 模型 API Playground；
- 第一阶段支持所有行业的低代码平台；
- 第一阶段自动处置生产故障的全自治 Agent；
- Secrets 管理产品；
- 服务器管理面板；
- 完整 BPMN 引擎；
- 无边界任意代码执行平台；
- Agent Marketplace；
- 重写 Pi Agent 已经提供的通用 Agent Loop、Skills 或 Extensions 系统。

## 5. 用户与使用场景

### 5.1 首要用户

- 5–30 人的工程或算法团队；
- 存在 Oncall、告警分析、问题定位和跨系统上下文收集；
- 希望使用数据分析、算法分析等不同职责 Agent；
- 能接受初期本地或单团队部署；
- 重视证据、人工确认、审计和可控自动化。

### 5.2 Jobs to Be Done

用户需要：

- 把重复排障步骤配置成 Workflow；
- 在聊天入口或 Web 触发 Workflow；
- 查看每个步骤状态、输入、输出和失败原因；
- 允许 Agent 主动请求补充信息；
- 确认关键结论对应的证据；
- 在发布前自动运行回归测试；
- 将失败 Run 转成新的 Test Case；
- 让可复用经验在受控条件下进入 Memory；
- 在系统升级或故障后恢复历史事实。

## 6. Golden Workflow

第一个真实价值验证用例是“定位 Issue 分析流程”：

```text
Feishu Trigger
  → Normalize / Ack
  → Router / Switch
  → Data Analysis Agent
      ↔ Human Input when needed
  → Algorithm Analysis Agent
      ↔ Human Input when needed
  → Sufficiency Guard
      ├─ insufficient → return to Data Analysis
      └─ sufficient → continue
  → Feishu Card Output
  → asynchronous Memory Curation
```

关键产品语义：

- 两个分析 Agent 是两个显式 Workflow Node；
- Agent 是否提问由其运行过程决定；
- Human Interaction 是同一 Node 的 `waiting` 状态；
- 受控 Loop 必须有退出条件和最大次数；
- Memory Curation 不阻塞主结果；
- 关键结论必须区分 Evidence、Inference 和 Uncertainty。

## 7. 产品原则

1. Workflow 控制过程，Agent 控制推理。
2. Definition 与 Run 分离。
3. 显式状态优先于隐式 Session 行为。
4. Pi Agent 是 Runtime 基础，不是平台公共协议。
5. 复用 Pi 的 Context、Skills 和 Extensions 能力，平台只补业务策略与治理。
6. 高风险动作必须经过 Policy、Approval 和 Audit。
7. 失败路径与恢复路径属于核心产品。
8. 测试是 Authoring 的组成部分，不是开发附属工具。
9. Memory 先保留证据，再生成可撤销派生知识。
10. 真实 Oncall 价值优先于节点数量和画布功能。

## 8. 功能域

### 8.1 Workflow

- JSON Definition；
- Schema 校验；
- 不可变 Version；
- Control Flow 与 Data Mapping 分离；
- Draft / Publish；
- Run 与 Node Run；
- 受控 Logic、Loop、Child Workflow。

### 8.2 Agent

- 独立 Agent Definition 和 Version；
- Model Policy；
- Pi Runtime；
- Tool、Skill、Interaction、Context 和 Memory Scope；
- 执行预算和明确终止原因。

### 8.3 Context

平台定义：

- 可用上下文来源；
- 作用域和访问权限；
- 当前节点需要哪些前序输出；
- Token 与敏感信息预算；
- Artifact、Thread Summary 和 Memory 的选择；
- 运行时实际使用内容的来源记录。

Pi Agent 和插件负责：

- 消息转换；
- 上下文裁剪或压缩；
- Tool/Skill 注入；
- Agent Loop；
- Runtime 事件。

### 8.4 Human Interaction

- Agent 主动提问；
- 显式 Human Input / Approval；
- 等待、超时、回复和恢复；
- 回复身份与幂等校验；
- Web 和 Channel 共用同一模型。

### 8.5 Tool、Skill 与 Evidence

- Tool 是可执行能力；
- Skill 是按需加载的 Runbook 和方法；
- Subagent 是 Agent 内部受控委派；
- Tool Gateway 负责权限、Secret、超时、重试、审计和证据；
- 早期默认只读和 Draft。

### 8.6 Testing

- Static Validation；
- Fixture；
- Provider / Tool Stub；
- Scripted Human Reply；
- 故障注入；
- Expected Path；
- 确定性 Assertion；
- 可选语义评价；
- Replay、Compare、Regression、Publish Gate。

### 8.7 Memory

- immutable episode；
- candidate extraction；
- deterministic hard gates；
- independent review；
- deterministic conflict resolution；
- active / quarantine / reject / supersede / expire；
- shadow rollout 和效果评估。

## 9. 用户体验原则

- 页面展示用户关心的状态和证据，不暴露 Runtime 内部复杂度；
- Workflow 图只表达稳定控制流；
- Tool Call、Interaction、Subagent 和 Artifact 作为运行事件展示；
- Run Detail 按 `Run → Node → Event / Evidence / Artifact` 渐进展开；
- 默认提供直观的 Test 和 Run 入口；
- 错误信息回答“发生了什么、影响什么、能否重试、下一步是什么”；
- 移动端优先支持查看、回答 Interaction 和阅读结果，不承担完整 Authoring。

## 10. 成功指标

### 10.1 平台可靠性

- 自动化验收通过率；
- Run 成功率；
- Worker Crash 后可解释终态比例；
- Stale Run 恢复时间；
- 重复事件导致的重复执行率；
- Secret 泄漏事件数。

### 10.2 Oncall 价值

- 首次有效诊断时间；
- 有证据支撑的关键结论比例；
- Agent 提问的有效率；
- 人工补充信息后的解决率提升；
- 明显误导建议率；
- Workflow 被重复使用的频率。

### 10.3 可维护性

- Workflow 变更后的回归发现率；
- 失败 Run 转 Test Case 的比例；
- 发布被自动门禁阻止的有效缺陷数；
- 文档与实现漂移数量；
- 支持包能否独立定位常见故障。

### 10.4 Memory

- Active Memory 的 Evidence 完整率；
- Quarantine 命中率；
- 过期 Memory 召回率；
- Memory 对后续结果的正向、无影响和负向贡献；
- 错误 Memory 传播率。

## 11. 阶段性产品结论

- M0：证明平台骨架成立；
- M1：证明可稳定回归；
- M2：证明长等待和 Agent-Human Interaction 成立；
- M3：证明真实 Oncall 价值；
- M4：证明非核心开发者可以安全 Author；
- M5：证明多人环境可以安全运营。

详细 Scope 和自动化退出门槛只在 Roadmap 与验收规范中维护，避免 PRD 成为任务清单。

## 12. 约束与假设

- 初期团队规模小，基础设施必须克制；
- M0 不拆大量微服务；
- 真实模型调用不能成为普通 CI 的硬依赖；
- 语义质量不能完全由单一 LLM Judge 自动证明；
- Feishu、生产 Tool 和 Memory 必须先有 Simulator / Stub；
- 任意代码执行必须晚于 Sandbox 和最小安全基线；
- Temporal 或其他 Durable Backend 必须通过验证后引入；
- Pi Agent 版本升级需要兼容测试，不允许静默改变历史 Run 语义。

## 13. 开放问题

- M1 Durable Execution Spike 后是否正式采用 Temporal；
- M3 Golden Workflow 的首批真实评测集规模和标注方式；
- Incident 与外部 Issue/Ticket 的映射边界；
- 生产 Tool 的首批只读集合；
- Memory 从 Shadow 切换到受控召回的阈值；
- M5 认证方式和 Workspace 隔离模型。
