# Design Doc：Automatic Memory Curation

- **版本**：v0.4
- **状态**：Accepted Design Direction
- **日期**：2026-07-14
- **计划实施阶段**：M3 分阶段启用
- **关联文档**：[PRD](./01-PRD.md) · [ADR](./03-ADR.md) · [Roadmap](./04-ROADMAP.md)

---

## 1. 核心结论

Memory 的目标不是保存更多内容，而是让后续 Oncall 在**证据充分、作用域正确、时效有效**的前提下复用经验。

本项目采用：

> **Immutable Episode + Candidate Extraction + Automatic Review + Deterministic Resolution + Quarantine**

同时坚持：

- Memory 不等于聊天记录；
- Thread Summary 不等于长期 Memory；
- Pi Agent 负责将已批准的相关 Memory 纳入当前 Agent 上下文；
- 平台负责 Memory 的来源、Scope、版本、权限、时效、审核和效果评估；
- M3 首先 Shadow，不直接影响主流程。

---

## 2. 为什么需要独立 Memory 设计

Oncall 经验具有以下风险：

- 同一现象在不同服务或环境中的原因不同；
- 版本升级后旧结论可能失效；
- Agent 推断容易被误当成事实；
- 一次偶然成功不代表可复用规律；
- 错误经验一旦自动召回，会持续影响后续判断；
- 无限摘要会逐步丢失原始证据。

因此，不能采用“每个 Run 结束后让模型重写一份总记忆”的简单方案。

---

## 3. 三类信息必须分开

### 3.1 Working Context

当前 Agent Node 为完成本次任务临时使用的信息，例如：

- 当前输入；
- 前序节点输出；
- 当前 Tool 结果；
- Human Reply；
- 当前 Artifact 摘要。

它随 Node 或 Run 结束，不默认成为长期知识。

### 3.2 Thread Summary

用于压缩同一对话或 Incident 中的历史消息，支持 Agent 后续继续工作。

特点：

- 服务于当前 Thread；
- 可以被重新生成；
- 不直接跨 Incident 召回；
- 不需要被当作已验证事实。

### 3.3 Long-term Operational Memory

跨 Run 复用的结构化知识，例如：

- 已验证服务事实；
- 诊断步骤；
- 故障模式；
- Tool 使用经验；
- 已证伪的方法；
- 特定版本和环境下的已知问题。

它必须有来源、证据、Scope、版本和生命周期。

---

## 4. Pi Agent 与平台的职责边界

### Pi Agent 和插件负责

- 在当前执行中接收相关 Memory；
- 将 Memory 与其他上下文一起交给模型；
- 按 Runtime 能力进行裁剪、压缩和消息组织；
- 记录实际使用情况和 Agent 输出。

### 平台负责

- 判断哪些 Run 可以形成 Episode；
- 选择允许抽取的证据；
- 确定 Memory Scope；
- 执行 Secret、PII、Schema 和权限硬门禁；
- 维护 Candidate、Revision、Quarantine、TTL 和 Supersede；
- 决定哪些 Memory 可以被召回；
- 记录 Memory 对结果的正负影响；
- 支持撤销和重新评估。

平台不重新实现 Pi Agent 的消息装配或压缩算法。

---

## 5. Memory 分层

### 5.1 Episode

一次 Workflow Run 的不可变证据包，至少关联：

- Workflow、Agent、Skill 和模型版本；
- 输入与最终结果；
- Node 输出；
- Tool Evidence；
- Human Interaction；
- 用户修正或反馈；
- Artifact；
- 时间、服务、环境和 Incident；
- 完成状态。

Episode 在保留期内不得被 LLM 改写。

### 5.2 Candidate

从 Episode 中提取出的结构化候选，类型包括：

- `semantic_fact`：稳定事实或约束；
- `procedural_rule`：可复用诊断步骤；
- `incident_pattern`：条件—现象—原因—处理模式；
- `tool_usage`：工具适用条件和解释方式；
- `negative_lesson`：已证伪做法或反例。

### 5.3 Active Memory

通过硬门禁、自动审核和确定性解析后，可进入默认召回范围的 Revision。

### 5.4 Quarantined Memory

可能有价值但存在下列问题：

- 证据不足；
- Reviewer 结果不稳定；
- 与现有 Memory 冲突；
- Scope 不明确；
- 时效关系未解决。

默认不进入 Agent 上下文。

### 5.5 Superseded / Expired / Rejected

- `superseded`：被更适用或更新 Revision 替代；
- `expired`：TTL 或有效期结束；
- `rejected`：不满足质量或安全门槛。

历史决策保留用于审计。

---

## 6. Automatic Memory Curation Workflow

```text
Run Reaches Explainable Terminal State
  → Capture Immutable Episode
  → Eligibility Filter
  → Candidate Extraction
  → Deterministic Hard Gates
  → Retrieve Related Memories
  → Independent Review
  → Deterministic Resolver
  → Commit Decision
  → Index and Observe
```

### 6.1 Eligibility Filter

不满足以下条件时，只保存 Episode：

- Run 有可解释终态；
- 关键结论有 Evidence；
- 不含未脱敏 Secret 或禁止保存的 PII；
- 不是纯闲聊或一次性无复用信息；
- Scope 可以确定；
- 来源用户和数据允许用于 Memory。

### 6.2 Candidate Extraction

Extractor 只能使用 Episode 和明确提供的 Evidence，不允许凭外部知识补全事实。

输出必须包含：

- 类型；
- 清晰陈述；
- Scope；
- Evidence References；
- 观察时间；
- 有效期或 TTL 建议；
- 相关实体和标签；
- 来源版本。

### 6.3 Deterministic Hard Gates

以下情况直接拒绝或隔离：

- Schema 不合法；
- Evidence 不存在或无访问权限；
- 包含 Secret、Token、Credential；
- 包含禁止保存的 PII；
- Scope 缺失；
- 完全重复；
- 只有一次性 ID 且无模式价值；
- 来源 Run 不可访问；
- 来源属于测试数据却被标记为生产事实；
- 结论超出 Evidence 所能支持的范围。

### 6.4 Independent Review

Reviewer 只接收：

- Candidate；
- Evidence 摘要；
- 少量相关 Memory；
- 版本、时间和 Scope 元数据。

Reviewer 评价：

- groundedness；
- utility；
- novelty；
- specificity；
- conflict type；
- 推荐动作和理由。

Reviewer 不直接修改数据库，也不能删除 Episode。

### 6.5 Deterministic Resolver

时间、版本和 Scope 关系由明确规则处理：

- 完全重复：追加 Evidence，不新增 Active Record；
- 新版本替代旧版本：创建新 Revision 并 Supersede；
- Scope 不同：并存；
- 冲突但证据不足：Quarantine；
- 过期：Expire；
- 高风险规则：要求更高分数、更多 Evidence 或二次独立复核。

---

## 7. Scope

最小支持：

```text
workspace
service
component
workflow
agent
incident
user（仅明确允许的偏好）
environment
version range
```

召回时必须同时满足：

- 调用者有权限；
- Scope 与当前 Run 相容；
- Revision 为 Active；
- 未过期；
- Evidence 仍可访问；
- 当前 Agent Policy 允许使用该 Memory 类型。

不得因为语义相似度高而绕过 Scope 和权限。

---

## 8. 分阶段启用

### M3.0：Episode Only

- 保存不可变 Episode；
- 不提取 Candidate；
- 不影响 Agent。

目标：验证数据质量、保留成本和脱敏。

### M3.1：Shadow Curation

- 自动提取、审核和解析；
- 产生 Candidate、Active 建议和 Quarantine；
- 结果不注入生产 Agent。

目标：测量错误率、冲突率和人工可解释性。

### M3.2：Offline Retrieval Evaluation

在固定历史案例上比较：

- No Memory；
- Candidate Active Memory；
- Shuffled / Irrelevant Memory 对照组。

目标：证明改进来自正确 Memory，而不是上下文变长或模型随机性。

### M3.3：Controlled Retrieval

只对低风险、范围明确、离线评测有正收益的 Memory 类型启用：

- 有限 Workflow；
- 有限服务；
- 有限 Agent；
- 小比例流量；
- 可一键关闭；
- 保留未使用 Memory 的对照样本。

### 后续阶段

逐步增加：

- 使用反馈；
- 自动重新评估；
- TTL 维护；
- 冲突复核；
- 扩大 Scope；
- 人工修正入口。

---

## 9. 最直观的自动化验证

### 9.1 基础正确性

```bash
make test-memory
```

固定 Episode Corpus 自动覆盖：

- 合法事实激活；
- 无 Evidence 拒绝；
- Secret/PII 拒绝；
- 完全重复合并；
- 新版本 Supersede；
- 不同环境并存；
- 未决冲突 Quarantine；
- TTL 到期；
- 测试 Episode 不污染生产 Scope；
- 权限不足无法召回；
- Episode 始终保持不可变。

这些测试使用固定 Extractor/Reviewer Response，不依赖真实模型。

### 9.2 离线效果评测

```bash
make evaluate-memory
```

固定 Evaluation Set 自动运行三个实验组：

```text
A: No Memory
B: Correct Active Memory
C: Shuffled / Irrelevant Memory
```

采集：

- 诊断正确性；
- Evidence 覆盖；
- 时间与成本；
- Memory 被引用比例；
- 错误 Memory 跟随率；
- 无效上下文干扰率；
- 人工修正率。

语义结果由确定性规则、辅助 Judge 和抽样人工复核共同判断。

### 9.3 发布门禁

Controlled Retrieval 必须满足：

- Hard Gate 测试全部通过；
- Shadow 期无严重权限或 Secret 事故；
- B 组优于 A 组；
- C 组未产生同等改善；
- 严重误导率不恶化；
- 支持按 Workflow/Agent 一键关闭；
- 有清理、回滚和重新索引方案。

---

## 10. 评价指标

### 质量

- Candidate groundedness；
- Activation precision；
- Quarantine rate；
- Conflict resolution accuracy；
- Wrong-memory-follow rate；
- Retrieval usefulness；
- Downstream diagnosis lift。

### 安全

- Secret / PII 漏检率；
- 跨 Scope 召回率；
- 越权访问率；
- 过期 Memory 使用率。

### 运维

- 每 Run Curation 成本；
- 存储增长；
- 处理延迟；
- Reindex 时间；
- Resolver 失败率。

---

## 11. 失败与回退

出现以下情况立即关闭 Active Retrieval，保留 Episode：

- 严重误导率上升；
- Secret 或跨 Scope 泄露；
- Memory 效果无法区别于随机上下文；
- Reviewer/Resolver 大量不稳定；
- 维护成本高于诊断收益。

回退不删除历史：

```text
Disable Retrieval
→ Stop New Activation
→ Preserve Episodes and Decisions
→ Re-evaluate Offline
→ Correct Rules / Versions
→ Controlled Re-enable
```

---

## 12. 可行性结论

该方案技术上可行，但不应作为 M0–M2 的关键路径。最合理顺序是：

```text
先完成可靠 Run 与 Evidence
→ M3 保存 Episode
→ Shadow Curation
→ 离线 A/B
→ 小范围 Controlled Retrieval
```

Memory 的成功标准不是“写入了多少条”，而是：

> **在不增加权限、过期和错误传播风险的前提下，后续 Oncall 结果可测量地变得更好。**
