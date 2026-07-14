# Product & Design：Workflow Testing UX

- **版本**：v0.4
- **状态**：Active Design Baseline
- **日期**：2026-07-14
- **主要阶段**：M1–M4
- **关联文档**：[PRD](./01-PRD.md) · [Roadmap](./04-ROADMAP.md) · [Automated Acceptance](./09-MILESTONE-AUTOMATED-ACCEPTANCE.md)

---

## 1. 产品目标

Workflow Testing 不是开发者隐藏在命令行里的附属功能，而是用户理解、验证和发布 Workflow 的主要方式。

用户应该能回答：

- 输入是什么；
- 实际走了哪条路径；
- 每个节点为什么成功、失败、等待或跳过；
- Agent 是否提出了必要的问题；
- 调用了哪些 Tool；
- 关键结论使用了哪些 Evidence；
- 新版本相对旧版本改变了什么；
- 该 Workflow 是否可以安全发布。

---

## 2. 测试层级

### 2.1 Static Validation

不执行 Workflow，检查：

- Definition Schema；
- 节点和连接；
- 输入输出类型；
- 不可达节点；
- Loop 退出条件；
- Agent、Skill、Tool、模型能力；
- 权限与环境要求；
- Publish 前必需配置。

### 2.2 Simulated Run

使用：

- Fake Provider；
- Tool Stub；
- Human Script；
- Channel Simulator；
- Test Clock；
- Output Sink。

目标是快速、确定性、无生产副作用。

### 2.3 Live Sandbox Run

使用真实模型或只读测试环境，但：

- 不使用生产写权限；
- 明确显示成本；
- 输出进入测试 Sink；
- 数据经过脱敏；
- 与生产 Run 隔离。

### 2.4 Evaluation Run

用于判断 Agent 语义质量和业务价值：

- 固定 Evaluation Set；
- 冻结版本；
- 重复运行；
- 辅助 LLM Judge；
- 抽样或高风险人工复核。

### 2.5 Production Replay

从失败或典型 Production Run 创建 Test Case，但必须：

- 脱敏；
- 冻结引用版本；
- 将生产 Tool 转成 Stub 或只读 Sandbox；
- 不复用生产 Secret；
- 标记数据来源和保留期限。

---

## 3. Workflow Test Case

一个 Test Case 应包含：

- 名称和目的；
- 绑定的 Workflow Definition Version；
- Agent、Skill、Tool 和 Runtime 版本；
- Input Fixture；
- Trigger / Channel Fixture；
- Provider Mock 或 Live Sandbox Policy；
- Tool Stub；
- Human Script；
- Test Clock；
- Expected Path；
- Deterministic Assertions；
- 可选 Semantic Evaluation；
- 数据敏感级别；
- 创建来源：手工、模板或 From Run。

用户不需要编辑复杂内部对象；界面应以表单、预设场景和可读摘要呈现。

---

## 4. 用户主流程

### Step 1：进入 Test

Workflow 页面保持统一导航：

```text
Design | Test | Runs
```

Design、Test、Runs 使用同一画布坐标和节点视觉语言。

### Step 2：选择 Test Case

常见预设：

- Happy Path；
- Missing Required Information；
- Provider Timeout；
- Tool Returns Empty；
- Agent Asks Follow-up；
- Human Reply Timeout；
- Worker Restart；
- Duplicate Channel Event。

支持 New、Duplicate、Import、From Run。

### Step 3：配置 Fixture

用户看到：

- 触发来源；
- 标准化输入；
- 环境、服务、Actor、Thread；
- 附件和 Artifact；
- 时间；
- 脱敏警告。

对于 Feishu，使用 Event Simulator，而不是要求用户编辑原始事件 JSON。

### Step 4：Preflight

点击 `Validate` 后：

- Blocking Error：必须修复；
- Warning：可继续但需确认；
- Passed：通过。

画布上的问题可以直接定位到节点或配置区域。

### Step 5：选择模式

```text
Simulated | Live Sandbox | Evaluation
```

默认 `Simulated`。

### Step 6：运行

画布展示：

- 当前节点；
- Completed / Waiting / Failed / Skipped；
- Actual Path；
- Loop Iteration；
- Agent Duration / Cost；
- Tool、Interaction、Artifact 作为节点旁的事件，不伪装成 Definition Node。

### Step 7：处理 Agent Interaction

当 Agent 请求信息：

- 同一节点显示 `Waiting for input`；
- Test Console 展示问题、原因、期望格式和超时；
- 可以由 Human Script 自动回复；
- 也可以手工输入或模拟 Invalid Reply / Timeout；
- 回复后同一节点继续运行；
- Timeline 保存 Request、Reply 和 Resume。

### Step 8：Inspect

逐级查看：

```text
Run
  → Node
      → Attempt
          → Agent Execution
              → Model / Tool / Interaction / Artifact / Event
```

默认显示可读摘要；Raw Data 按需展开。

### Step 9：Assertions

结果分为：

- Passed；
- Failed；
- Warning；
- Not Evaluated。

### Step 10：保存与比较

支持：

- Save as Test Case；
- Update Fixture；
- Record Baseline；
- Compare Versions；
- Add to Regression Suite；
- Mark Required for Publish。

---

## 5. 最优先的确定性断言

优先自动验证：

- Run 达到预期终态；
- 指定 Node 执行或未执行；
- 指定 Edge 被采用；
- 下游未在上游失败后执行；
- Interaction 由正确 Agent 发出；
- Interaction 次数和超时；
- Reply 只消费一次；
- Tool 在 Allowlist 内；
- Tool 输入和输出 Schema；
- 关键 Evidence 数量和来源；
- Artifact 存在且权限正确；
- 输出满足 Schema；
- Loop Iteration 不超过上限；
- Token、Cost、Latency 不超过预算；
- 无生产副作用；
- 无 Secret 出现在输出和日志；
- Event 顺序与状态投影一致；
- Context 中没有越权 Scope 的 Memory 或 Artifact。

---

## 6. Snapshot 与 Diff

可以保存：

- 标准化 Output；
- 关键 Node Output；
- Tool Request；
- Feishu Card；
- Interaction Schema；
- Actual Path；
- Context Source 清单；
- Artifact Metadata。

Snapshot 必须支持忽略：

- 时间戳；
- 随机 ID；
- Trace ID；
- 非决定性措辞；
- 已声明可变化字段。

Version Compare 应优先解释：

1. 流程路径变化；
2. Agent/Skill/Tool/模型版本变化；
3. 权限与预算变化；
4. Interaction 变化；
5. Evidence 变化；
6. 输出、成本和耗时变化。

---

## 7. Semantic Evaluation

LLM Judge 只用于确定性断言无法覆盖的维度：

- 是否回答了问题；
- Evidence 是否支持结论；
- 建议是否明确可执行；
- Agent 提问是否必要、清晰；
- 是否存在明显误导。

规则：

- Judge Prompt、模型和版本必须记录；
- Judge 输出结构化；
- 不以单一总分替代安全门禁；
- Judge 不得覆盖确定性失败；
- 对严重风险使用两个独立 Judge 或人工复核；
- Judge 分歧进入 Review Queue；
- 发布门禁不能仅依赖不稳定 Judge 分数。

---

## 8. 故障注入

Test Mode 和 Milestone Acceptance 共用故障目录：

- Provider Auth Failure；
- Rate Limit；
- Timeout；
- Empty / Invalid Output；
- Worker Crash；
- Duplicate Queue Claim；
- Database Disconnect；
- SSE Disconnect；
- Tool Timeout；
- Tool Side-effect Outcome Unknown；
- Missing Evidence；
- Invalid Human Reply；
- Duplicate / Late Reply；
- Channel Duplicate Event；
- Context Overflow；
- Compaction；
- Subagent Timeout；
- Memory Scope Mismatch；
- Artifact Access Denied；
- Budget Exceeded；
- No-progress Termination。

用户可以选择预设，不需要理解底层注入实现。

---

## 9. Test Report

每次 Test Run 生成统一摘要：

```text
Result
Actual Path
Failed Assertions
Warnings
Interactions
Tool Calls
Evidence
Artifacts
Cost / Duration
Version Snapshot
Reproduction Command
```

失败项必须回答：

- 发生在哪里；
- 预期是什么；
- 实际是什么；
- 是否可重试；
- 建议查看什么证据；
- 如何复现。

---

## 10. Publish Gate

发布前可以配置 Required Suite。阻断条件至少包括：

- Static Validation Error；
- Required Test 失败；
- 未批准的 Tool 权限扩大；
- 模型能力不满足；
- Loop 无上限；
- Human Interaction 无 Timeout；
- Production Output 在 Simulated Run 中被触发；
- Secret/PII 检测失败；
- 严重 Semantic Safety Case 失败。

Warning 必须有 Owner、理由和过期时间，不能永久忽略。

---

## 11. 与 Milestone 的关系

### M0

只提供系统级 Smoke，不要求完整 Test UX。

### M1

交付 Test Case、Fixture、Mock、确定性 Assertion、Replay 和 CLI/API。

### M2

增加 Human Script、Test Clock、Waiting/Resume、Loop 和 Child Workflow。

### M3

增加 Feishu Simulator、Tool Stub、Evidence、Memory Shadow 和 Evaluation Set。

### M4

将上述能力整合进可视化 Test Mode、Compare 和 Publish Gate。

### M5

增加 Workspace 权限、安全攻击场景、Sandbox、Quota 和审计测试。

---

## 12. 可行性原则

- 普通 CI 不依赖真实模型；
- 确定性测试先于语义评测；
- 真实模型评测必须冻结版本并重复运行；
- Test 和 Production 使用同一执行模型，但隔离 Secret、Output 和 Tool 权限；
- 自动化测试负责证明平台行为，不能单独证明真实业务价值；
- 任何失败 Production Run 都应能低成本转为回归 Test Case。

最终目标是：

> **让一个不熟悉实现技术的 Workflow Owner，也能通过可视化路径、清晰断言和一键回归，判断 Workflow 是否可信。**
