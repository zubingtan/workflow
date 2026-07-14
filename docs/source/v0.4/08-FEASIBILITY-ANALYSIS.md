# Full Feasibility Analysis：Oncall Workflow Platform v0.4

- **版本**：v0.4
- **状态**：Review Baseline
- **日期**：2026-07-14
- **分析范围**：README、PRD、Design Doc、ADR、Roadmap、Documentation Governance、Memory Design、Workflow Testing UX
- **参考**：Pi Agent 能力边界、DeerFlow Agent Harness 工程实践

---

## 1. 执行结论

### 总体判断

> **方案整体可行，可以进入 M0；但必须严格按 M0→M1→M2→M3 的风险消除顺序实施。**

最重要的成立条件是：

1. 不把 Pi Agent 当成完整 Workflow Platform；
2. 不重复实现 Pi Agent 已具备的 Agent Loop、上下文转换和扩展机制；
3. 平台专注于 Workflow、持久化执行、权限、Evidence、Testing、Channel 和治理；
4. 在 M1 证明恢复与测试能力后，再进入长时间 Waiting；
5. 在 M3 证明真实 Oncall 价值后，再大规模投入 Builder、多团队和自治能力。

### 可行性分级

| 领域 | 判断 | 主要原因 |
|---|---|---|
| 产品定位 | 高 | 问题真实，Golden Workflow 清晰，范围已收敛 |
| M0 本地闭环 | 高 | 技术成熟、依赖少、可用 Fake Provider 完整验证 |
| Pi Agent 集成 | 高 | 适合作为可嵌入 Agent Runtime，但需要平台适配层 |
| 异步 Workflow Runtime | 高 | PostgreSQL Queue 足以支撑 M0/M1 单团队规模 |
| Human Waiting / Resume | 中高 | 可通过 Durable Execution 实现，但必须先做 Spike |
| Feishu 接入 | 高 | Adapter 边界清晰，主要风险在幂等、身份和会话恢复 |
| Tool Gateway | 中高 | 只读工具可行；写操作和 outcome-unknown 较复杂 |
| Memory | 中 | 技术可做，但质量收益不确定，必须 Shadow/A-B |
| Visual Builder | 中高 | 技术成熟，但容易过早锁死 DSL，应放 M4 |
| 小团队安全 Beta | 中 | 可行但工作量大，涉及 Auth、RBAC、Sandbox、运维 |
| 完全自动化验收 | 中高 | 平台行为可高度自动化，业务价值不能完全无人评估 |

---

## 2. 方案是否解决了正确的问题

v0.4 的产品问题定义成立：真正需要解决的不是“如何再做一个 Agent 聊天页面”，而是如何把以下内容组织成一个可靠的业务执行单元：

- 明确 Trigger；
- 可版本化 Workflow；
- 专业 Agent 分工；
- 缺失信息时主动询问；
- 工具调用和 Evidence；
- 失败、重试、等待、恢复；
- 最终输出；
- 回归测试；
- 经验沉淀。

对于 Oncall，确定性流程与 Agent 推理并存是必要的：

- 路径、权限、审批、超时和恢复需要确定性；
- 分析、归纳、问题生成和解释需要 Agent；
- 让 Agent 自由控制整个生产流程会损害审计和安全；
- 把 Agent 限制成单轮文本节点又无法处理信息不足和动态探索。

v0.4 的原则“Workflow 控制过程，Agent 控制节点内部推理”是合理平衡。

---

## 3. Pi Agent 与 Context Engineering 可行性

### 3.1 结论

Pi Agent 可以承担本项目的 Agent Runtime 基础，不需要平台再造一个通用 Agent Harness。

适合复用的能力包括：

- Agent 状态和消息循环；
- Tool 执行与事件；
- 通过扩展和 Skills 增加能力；
- 上下文转换、裁剪、注入和压缩；
- Session / Transcript；
- 程序化调用和事件流。

### 3.2 平台仍需补什么

Pi Agent 不知道本项目的业务语义，因此平台仍需定义：

- 当前 Workflow Run、Node、Thread、Incident；
- 当前 Agent 被允许看到哪些前序输出；
- Skill、Tool、Memory 和 Artifact 的版本与权限；
- Token、时间、成本和交互预算；
- Test 与 Production 的隔离；
- 上下文来源追踪和 Replay；
- Secret、PII 和跨 Scope 数据限制。

这不是重新实现 Context Engineering，而是提供一份平台级 Context Policy，由 Pi Agent Adapter 转换为 Runtime 可以使用的输入。

### 3.3 主要风险

- 过度依赖 Pi 内部 Session 格式；
- Pi 升级导致事件或上下文行为变化；
- 插件可以绕过平台权限；
- 上下文压缩导致关键 Evidence 丢失；
- Transcript 过大导致存储和成本增长。

### 3.4 控制措施

- 业务模型不保存 Pi 内部 ID 作为主键；
- 建立 Runtime Compatibility Suite；
- Tool 必须经过平台 Gateway，插件不能直接持有生产凭据；
- 保存 Context Source 清单和关键 Evidence 引用；
- 大输出转 Artifact，模型只接收摘要和引用；
- 每次升级 Pi 前运行固定契约与回归套件。

**判断：高可行。**

---

## 4. M0 可行性

M0 的范围合理，且是最适合立即开发的阶段。

### 技术依赖

- Docker Compose；
- PostgreSQL；
- 一个 Web/API 应用；
- 一个 Worker；
- Pi Agent；
- 一个 OpenAI-compatible Provider；
- Fake Provider。

这些依赖均不存在明显研发未知数。

### 最容易失败的地方

不是模型调用本身，而是：

- Run 状态与数据库事务；
- Worker Crash 后租约恢复；
- Definition Version；
- 错误传播；
- Secret 脱敏；
- UI 与实际状态不一致。

v0.4 已将这些作为 M0 Exit Criteria，而不是延后到“生产化”阶段，方向正确。

### 工作量控制

M0 不应实现：

- 完整 Builder；
- 通用表达式；
- 多 Agent 动态编排；
- Human Waiting；
- Memory；
- Tool Gateway；
- 微服务拆分。

只要遵守 Non-goals，M0 具有较高完成概率。

**判断：高可行，建议立即开始。**

---

## 5. M1 可靠性与测试可行性

M1 是整个项目最重要的基础阶段之一，因为后续 Waiting、Feishu 和 Memory 都依赖可恢复执行与可重复测试。

### 成立原因

- Attempt、Event、Retry、Cancel、SSE、Replay 都是成熟工程模式；
- Fake Provider、Tool Stub 和故障注入能让大部分测试确定性运行；
- PostgreSQL Queue 在早期规模下足够；
- Test Case 与 Production Run 共用执行模型，减少两套系统漂移。

### 复杂点

- Model/Tool 请求发出后 Worker Crash，平台无法确定外部是否已执行；
- Event 和状态表可能短暂不一致；
- Retry 可能造成重复外部副作用；
- Replay 无法复现模型随机性；
- SSE 断线续传需处理重复事件。

### 必须接受的现实

“Replay”应定义为：

- 能重放相同输入、版本和替身；
- 能比较路径与结果；
- 不承诺真实模型逐字一致。

需要复现模型结果时，应使用 Recorded Response 或固定 Fake Provider，而不是假定真实模型确定性。

**判断：高可行，但必须在此阶段建好事件和 Attempt。**

---

## 6. M2 Human Waiting 与 Durable Execution 可行性

### 为什么可行

Agent 主动请求 Human Input 可以被建模为明确状态：

```text
Agent requests input
→ persist Interaction
→ Node waiting
→ external reply signal
→ validate and consume once
→ resume same Node
```

Durable Execution 系统可以承担长时间 Timer、Signal、Retry 和服务重启恢复。

### 为什么不能直接锁死实现

Temporal 很可能适合，但在正式投入前需要验证：

- 本地 Docker 体验；
- 版本升级和 Workflow 代码兼容；
- Signal 幂等；
- 数据备份和恢复；
- 从 M0 Queue 迁移；
- 运维复杂度；
- 团队是否能够长期维护。

因此 v0.4 将“Durable Execution 能力”设为强制要求，把具体产品留给 M1 Spike，是更可行的决策。

### 主要风险

- Agent checkpoint 不能可靠恢复；
- Reply 到达时 Node 已超时或取消；
- 重复 Reply 重复推进；
- 同一 Thread 并发消息互相污染；
- 等待期间 Workflow/Agent Definition 已更新。

### 控制措施

- Run 始终绑定旧版本，不因新发布而改变；
- Interaction Reply 只消费一次；
- 使用 Test Clock；
- 明确定义 serialize/queue/interrupt/fork 策略；
- checkpoint 不依赖 Worker 进程内对象；
- 自动化覆盖重启、重复、过期和错误 Actor。

**判断：中高可行，前提是 M1 Spike 通过。**

---

## 7. M3 Golden Workflow 可行性

### 平台实现可行性

Feishu Adapter、两个 Agent、只读 Tool、Evidence 和 Card Output 都是可实现的，且边界已经明确。

### 产品价值不确定性

真正不确定的是：

- 两个 Agent 是否比一个 Agent 更好；
- Agent 提问是否真的减少返工；
- 获取 Tool Context 的成本是否低于人工；
- 结果能否稳定关联 Evidence；
- Workflow 维护成本是否过高；
- 用户是否愿意在 Feishu 中持续使用。

这类问题无法通过架构设计直接证明，只能通过固定数据集和真实使用验证。

### 正确验证方式

M3 应区分：

1. **平台正确性**：签名、幂等、Tool、Evidence、Thread、Memory Gate，可自动化；
2. **Agent 质量**：固定案例、冻结版本、重复运行、Judge + 人工复核；
3. **业务价值**：首次有效诊断时间、人工修正率、真实采用率。

不能用几个演示案例或单一 LLM Judge 分数宣布成功。

**判断：技术高可行，产品价值中等不确定；M3 是关键 Go/Pivot 阶段。**

---

## 8. Tool、Skill 与 Subagent 可行性

### Tool

只读 Tool 最适合作为 M3 起点：日志、指标、Deployment、Git、Runbook、历史 Incident。

主要复杂性：

- 超时和限流；
- 凭据；
- 大输出；
- 结果证据化；
- 外部执行成功但响应丢失；
- 测试替身。

对于写 Tool，必须处理 `outcome_unknown`，不能简单自动 Retry。

### Skill

Skill 是低成本、高价值能力：把 Runbook 和领域判断以版本化内容交给 Agent，按需加载，避免所有知识长期塞入 Prompt。

需要控制：

- 来源；
- 版本；
- 适用服务/环境；
- 必需 Tool；
- 发布状态；
- 是否经过 Review。

### Subagent

技术可行，但不是前期必要能力。

稳定业务步骤应继续使用 Workflow Node；Subagent 只用于 Agent Node 内部的短任务探索，并受并发、时间和成本限制。

**判断：Tool/Skill 中高可行；Subagent 可行但应晚于主流程验证。**

---

## 9. Memory 可行性

### 技术上可行

Episode、Candidate、Review、Resolver、Vector Retrieval、TTL 都可用常规数据库和模型能力实现。

### 价值上风险较高

Memory 的失败通常不是“系统报错”，而是悄悄降低后续 Agent 质量：

- 错误经验被跟随；
- 旧版本事实被重用；
- Scope 混淆；
- 召回内容过多；
- Reviewer 自信但错误；
- 成本增长却无明显收益。

### v0.4 的改进

- Episode 与 Thread Summary 分开；
- Shadow 优先；
- No Memory / Correct Memory / Shuffled Memory 三组评测；
- Controlled Retrieval；
- 一键关闭和保留审计；
- Memory 不阻塞主 Workflow。

这显著提高可行性。

**判断：中等可行，不应进入 M0–M2 关键路径。**

---

## 10. Visual Builder 可行性

### 技术可行

节点画布、表单、Diff、Test Console 和 Run Timeline 都有成熟前端实现方式。

### 最大风险

不是前端难，而是 DSL 和运行语义尚未稳定时过早开发：

- UI 产生隐藏状态；
- 保存格式与 Runtime 不一致；
- 重做 Mapping、Loop 和 Interaction；
- 大量工作投入在视觉而非业务价值。

将完整 Builder 放到 M4 是合理顺序。

在 M0–M3，只需保持：

- 只读 Board；
- 清晰 Run Detail；
- Test Case 的简单表单/接口；
- 稳定 JSON Schema。

**判断：中高可行，时序正确比技术选型更重要。**

---

## 11. 安全与团队部署可行性

完整多团队安全平台工作量较大，但小团队 Beta 可以分阶段实现。

### M0–M2 最低要求

- 默认本地或受控网络；
- Secret 仅服务端；
- 日志脱敏；
- Test/Production 隔离；
- 不支持任意代码；
- Tool 只读或 Draft；
- Artifact 安全下载。

### M3 Channel 前最低要求

- Feishu 签名；
- Replay Protection；
- User Allowlist；
- Thread 和 responder 绑定；
- Artifact Token；
- Prompt Injection Trust Label；
- Read-only Tool。

### M5 主要工作

- Auth / Workspace / RBAC；
- Secret Lifecycle；
- Sandbox；
- Quota；
- Audit；
- Retention；
- Upgrade/Rollback；
- SLO/Oncall。

Pi Agent 本身不应被视为完整安全边界；宿主平台、Tool Gateway 和 Sandbox 必须承担该职责。

**判断：小团队可行，企业级范围不应纳入早期承诺。**

---

## 12. 自动化验收可行性

### 可以高度自动化的部分

- Schema、Compiler 和状态机；
- Queue、Crash、Retry、Cancel；
- Waiting、Signal、Timeout；
- Channel 签名、幂等和回复校验；
- Tool Policy、Stub 和 Evidence；
- Memory Hard Gate；
- RBAC、Sandbox、Quota；
- Builder E2E 和 Publish Gate。

### 不能完全自动证明的部分

- 诊断是否真正有业务价值；
- 输出是否在复杂边界案例中误导；
- Agent 提问是否值得打断用户；
- Memory 是否长期提高团队能力；
- 用户是否愿意持续采用。

### 最合理模型

```text
Deterministic CI
+ Fixed Evaluation Set
+ Repeated Real-model Runs
+ Auxiliary Judges
+ Risk-based Human Review
+ Production Metrics
```

因此，v0.4 不承诺“所有质量无人值守判断”，而承诺“一键完成执行、证据收集、统计和风险筛选”。这是更诚实也更可行的自动化目标。

---

## 13. 关键路径与依赖

```text
M0: Definition + Run + Pi + Persistence
  ↓
M1: Attempt + Events + Recovery + Test Foundation
  ↓
Durable Execution Spike
  ↓
M2: Waiting + Interaction + Thread
  ↓
M3: Feishu + Tool + Evidence + Golden Evaluation
  ↓
Business Go/Pivot Decision
  ├─ Go → M4 Builder
  └─ Proven team demand → M5 Beta Governance
```

不在关键路径：

- Active Memory；
- Subagent Marketplace；
- 任意代码；
- K8s Sandbox；
- 多租户；
- 完整 Scheduler；
- 大量 Node 类型。

---

## 14. Top Risks

| 风险 | 概率 | 影响 | 主要控制 |
|---|---:|---:|---|
| M0 Scope 扩张 | 高 | 高 | 严格 Non-goals、`verify-m0` |
| Pi 内部实现泄漏到业务模型 | 中 | 高 | Adapter、Compatibility Suite |
| Worker Crash 导致重复外部调用 | 中 | 高 | Attempt、幂等、outcome_unknown |
| Waiting 恢复不可靠 | 中 | 高 | Durable Spike、重启/重复 Reply 测试 |
| Agent 输出看似合理但证据不足 | 高 | 高 | Evidence Gate、Evaluation Set |
| Tool 权限过大 | 中 | 极高 | Gateway、只读优先、Approval |
| Memory 错误传播 | 中 | 高 | Shadow、Quarantine、A/B、Kill Switch |
| Builder 过早锁死 DSL | 高 | 中 | 延后 M4、Schema 为事实来源 |
| 测试只验证 Demo，不验证故障 | 中 | 高 | 故障矩阵和 Acceptance Evidence |
| 多团队安全工作量失控 | 中 | 高 | M5 限定 Small-team Beta |

---

## 15. 阶段性 Go / No-go 建议

### 现在

**GO M0。**

前置条件：

- v0.4 文档作为当前基线；
- 建立 M0 Implementation Plan；
- 从第一天创建 `make verify-m0`；
- 使用 Fake Provider；
- 不实现 M1+ Non-goals。

### M0 结束

只有 `verify-m0` 连续通过并完成重启/Crash/Secret 验证，才进入 M1。

### M1 结束

只有 Runtime 故障矩阵、Backup/Restore 和 Durable Spike 通过，才进入 M2。

### M2 结束

只有 Waiting 可跨重启恢复、Reply 幂等和 Test Clock 场景通过，才接真实 Feishu。

### M3 结束

必须基于业务指标决定：

- **GO**：诊断时间和证据质量改善，风险可控；
- **REWORK**：平台正确，但 Agent/Workflow 质量不足；
- **PIVOT**：用户价值或维护成本假设被证伪。

M4 和 M5 不应因 Roadmap 存在就自动启动。

---

## 16. 最终建议

1. 立即以 v0.4 为基线进入 M0；
2. 首个工程产物不仅是页面，而是 `make verify-m0`；
3. M0 保持单 App、单 Worker、PostgreSQL 的简单部署；
4. Pi Agent 作为 Runtime，不把 Pi Session 变成业务模型；
5. Context Engineering 复用 Pi 机制，平台只定义 Policy、Scope、Provenance 和 Replay；
6. M1 优先于增加任何复杂 Node；
7. Durable Execution 先 Spike，后锁定产品；
8. M3 将平台正确性和业务价值分开验收；
9. Memory 默认 Shadow，不阻塞 Golden Workflow；
10. 只有真实价值证据成立，才投入完整 Builder 和团队化治理。

最终结论：

> **这不是一个技术上不可控的大项目，而是一个必须用严格阶段门禁控制范围的中长期平台项目。v0.4 已具备进入开发的可行性；最大的风险不是能否写出来，而是是否在价值验证前过早建设过多平台能力。**

---

## 17. 与 DeerFlow 的可行性对照

DeerFlow 证明了长任务 Agent 系统中的若干机制可以被产品化组合：线程状态、Skills、Subagent、Sandbox、Artifact、Context Compaction、配置诊断和可观察性。这降低了本项目在“Agent 如何持续执行”方面的不确定性。

但两者的产品约束不同：

| 维度 | DeerFlow 典型方式 | 本项目采用方式 |
|---|---|---|
| 主编排 | Lead Agent 运行式推进 | 版本化 Workflow 确定性推进 |
| Agent 自由度 | 全局较高 | 限制在 Agent Node 内 |
| 长任务状态 | Thread / Checkpoint | Workflow Run + Node + Thread + Durable State |
| Tool | Agent Runtime 能力 | Tool Gateway、Policy、Evidence、Approval |
| Memory | 运行时注入和提取 | Episode、审核、Scope、Quarantine、A/B |
| Subagent | 核心长任务能力 | 可选内部委派，不替代 Workflow Node |
| Sandbox | Agent 执行环境 | 还需叠加 Workspace、凭据和生产权限治理 |
| 成功标准 | 长任务完成与交付物 | Oncall 时间、证据、风险和可恢复性 |

该对照进一步支持 v0.4 的核心判断：

- DeerFlow 的 Harness 经验值得吸收；
- Pi Agent 已可提供本项目需要的底层可扩展 Agent Runtime；
- 本项目真正需要自行建设的是 Oncall Control Plane，而不是再复制一个 DeerFlow。
