# Design Doc：Reviewed Memory and Automatic Curation

- **版本**：v0.6
- **状态**：Target Architecture / Not in Current Implementation
- **日期**：2026-07-17
- **目标阶段**：M5；M3 可开始 Shadow 数据收集

## 1. 决策

Memory 是完整平台的一部分，但不进入 M0–M2 的当前实现 Goal。

原因：

- 当前首先需要证明 Workflow 和真实 Oncall 价值；
- 没有稳定 Run、Evidence、Actor 和 Scope，Memory 无法可信；
- 过早加入 Memory 会放大错误结论和上下文污染。

## 2. 目标

Memory 应做到：

- 来源可追踪；
- Scope 明确；
- 可审查；
- 可撤销；
- 可过期；
- 可冲突；
- 可隔离；
- 可评估；
- 可 Kill Switch。

Memory 不等于把所有聊天或 Run 摘要放进向量库。

## 3. 核心对象

### MemoryEpisode

不可变事实包：

- Run/Thread/Incident；
- Definition/Agent/Tool Version；
- Input；
- Evidence；
- Outcome；
- Actor；
- timestamps；
- provenance；
- sensitivity。

### MemoryCandidate

从 Episode 提取的候选：

- statement；
- category；
- scope；
- confidence；
- supporting evidence；
- expiration proposal；
- conflicts；
- extraction version。

### ReviewedMemory

可被检索的受控记忆：

- canonical statement；
- scope；
- status；
- source candidates；
- review record；
- validFrom/validUntil；
- supersedes/supersededBy；
- retrieval policy；
- risk label。

## 4. Pipeline

```text
Workflow Run completed
  → immutable Episode
  → Candidate Extraction
  → deterministic Hard Gates
  → lightweight review
  → conflict resolution
  → quarantine / reject / active
  → shadow retrieval
  → offline evaluation
  → controlled activation
```

Memory Curation 作为异步 Child Workflow，不阻塞主 Workflow 输出。

## 5. Hard Gates

以下情况默认拒绝或 Quarantine：

- 无来源；
- 无 Scope；
- 无 Evidence；
- 包含 Secret；
- 个人敏感信息无明确用途；
- 与现有 Active Memory 冲突且未解决；
- 结论来自单次低置信推断；
- 已过期；
- 内容是临时状态；
- 可能诱导生产写操作；
- Agent 生成代码或命令未经 Review。

## 6. Scope

至少支持：

- global；
- workspace；
- project；
- service；
- workflow；
- agent；
- incident type；
- user-private。

默认使用最小 Scope，不自动扩大。

## 7. 激活策略

### M3 Shadow

- 仅生成 Episode/Candidate；
- 不影响在线 Prompt；
- 统计潜在检索结果。

### M5 Offline A/B

- 对固定评估集比较；
- 计算正向、无影响、负向贡献；
- 检查过期和冲突召回。

### Controlled Retrieval

- 小 Scope；
- 只读；
- 明确 provenance；
- 有 Kill Switch；
- 负向指标触发回退。

## 8. 群聊学习

群聊学习必须显式配置：

- Channel/Group；
- 时间窗口；
- 运行周期；
- 允许的数据类型；
- Scope；
- retention；
- opt-out；
- reviewer。

禁止无界扫描历史群聊并自动激活。

## 9. 与 Workflow 的关系

Memory 通过 Context Policy 注入 Agent，不通过普通 Edge 传递。

Run 必须记录：

- 检索到哪些 Memory；
- Memory Version；
- 作用 Scope；
- 是否被 Agent 使用；
- 结果和 Evidence。

## 10. 测试

Memory 测试关注：

- provenance；
- scope isolation；
- expiry；
- conflict；
- secret filtering；
- negative contribution；
- kill switch；
- reproducible retrieval snapshot。

禁止用单一 LLM Judge 宣称 Memory 质量通过。

## 11. Non-goals

- M0/M1 在线检索；
- 自动修改 Workflow；
- 自动执行记忆中的命令；
- 永久保存所有聊天；
- 把 Skill、Runbook 或 Tool Schema 当作 Memory；
- 无审查的自我进化。
