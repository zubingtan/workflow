# Roadmap：Oncall Workflow Platform

- **版本**：v0.4
- **状态**：Active Development Baseline
- **日期**：2026-07-14
- **关联文档**：[PRD](./01-PRD.md) · [Design Doc](./02-DESIGN-DOC.md) · [ADR](./03-ADR.md) · [Automated Acceptance](./09-MILESTONE-AUTOMATED-ACCEPTANCE.md)

本 Roadmap 按风险消除顺序组织，不是日期承诺。每个阶段只有在自动化验收报告满足退出门槛后才进入下一阶段。

---

## 1. Roadmap 原则

1. 先证明最小执行闭环，再扩充节点类型；
2. 先证明恢复、幂等和测试，再引入长时间等待；
3. 先证明 Agent-Human Interaction，再接入真实聊天渠道；
4. 先证明真实 Oncall 价值，再建设完整可视化 Builder；
5. Pi Agent 和插件承担 Agent 执行机制，平台只补业务编排与治理；
6. Memory 先保留 Episode，再 Shadow 评估，最后受控启用；
7. 生产写操作晚于只读诊断能力；
8. 每个 Milestone 都必须有一条直观的一键验收命令；
9. 自动化测试优先使用确定性替身，真实模型仅用于独立评测；
10. Roadmap 管 Outcome，Issue Tracker 管任务。

---

## 2. 阶段总览

| 阶段 | 核心问题 | 主要产出 | 主验收命令 |
|---|---|---|---|
| M0 | 执行骨架是否成立 | Compose、JSON Workflow、Pi Agent、Run/Node Run、只读 Board | `make verify-m0` |
| M1 | 是否可靠、可重复、可回归 | retry、recovery、事件流、Test Case、Replay、Backup | `make verify-m1` |
| M2 | Agent 能否可靠等待并恢复 | Durable Execution、Interaction、Waiting、受控 Loop | `make verify-m2` |
| M3 | 是否真实改善 Oncall | Feishu、两个分析 Agent、只读 Tool、Evidence、受控 Memory | `make verify-m3` |
| M4 | 非核心开发者能否安全构建 | Builder、Test Mode、Diff、Publish Gate | `make verify-m4` |
| M5 | 小团队能否安全共用 | Auth、RBAC、Secret、Sandbox、Quota、Audit、SLO | `make verify-m5` |

---

# M0：Local Executable Workflow Skeleton

## 关键问题

> 在一台干净机器上，是否能一键部署并稳定运行 `Input → Pi Agent → Markdown Output`？

## Outcome

用户无需理解内部 Web 技术，只需：

```text
clone → 配置模型 → make up → 打开 Web → 运行 Workflow → 查看结果
```

## Scope

- Docker Compose；
- PostgreSQL、migration、seed；
- JSON Workflow Import 与校验；
- 不可变 Definition Version；
- `input.prompt`、`process.agent`、`output.markdown`；
- Pi Agent Runtime Adapter；
- OpenAI-compatible Provider Binding；
- 异步 Worker；
- Workflow Run、Node Run、基础执行事件；
- Workflow List、只读 Board、Run Form、Run Detail、History；
- Fake Provider；
- `setup`、`doctor`、`smoke-test`、`support-bundle`。

## Non-goals

Builder、Feishu、Logic/Loop、Human Interaction、Tool Gateway、Memory、Subagent 平台化、任意代码、多用户、Temporal。

## 自动化验收

运行：

```bash
make verify-m0
```

验收程序必须自动完成：

1. 在隔离目录生成测试配置并启动 Compose；
2. 检查 database、migration、app、worker readiness；
3. 导入合法 Workflow 并运行 Happy Path；
4. 导入非法 Workflow，确认返回明确字段错误；
5. 模拟 Provider 鉴权失败、超时和空输出；
6. 在 Agent 执行中终止 Worker，确认租约过期后恢复或明确失败；
7. 重启全部容器，确认历史 Run、Node 状态和输出仍存在；
8. 使用浏览器自动化执行“打开页面—运行—查看详情”；
9. 扫描日志、API 响应和数据库导出，确认不含测试 Secret；
10. 生成机器可读报告和人可读摘要。

## Exit Criteria

- `make verify-m0` 连续三次通过；
- 新机器首次运行不依赖手工数据库操作；
- 上游节点失败时 Output 不执行；
- Worker Crash 后 Run 不永久停留在 `running`；
- Definition Version 能解释历史 Run；
- Secret 未泄露；
- 验收报告包含 Run ID、版本、状态、日志摘要和失败截图。

## Rework Criteria

出现任一情况暂停扩功能：

- 完整 Agent 调用仍依赖 HTTP 请求生命周期；
- Pi Session ID 被用作业务 Run ID；
- UI 状态成为 Workflow 事实来源；
- Provider Secret 进入 Definition 或 Run；
- Crash 后执行结果不可解释。

---

# M1：Reliable Runtime and Test Foundation

## 关键问题

> 系统能否长期重复执行，并对 Workflow 版本变化做可复现回归？

## Outcome

相同 Test Case 可以稳定重跑；故障、重试和恢复都有明确 Attempt 与事件证据。

## Scope

- Node Run Attempt；
- timeout、retry、cancel、manual retry；
- stale recovery 和幂等；
- 持久化 Execution Event；
- SSE 断线续传；
- Agent Definition Version；
- 模型能力校验；
- Token、Cost、Latency；
- Agent Budget 与 Completion Contract；
- Workflow Test Case、Fixture、Mock、Assertion；
- Replay、Compare、Regression Suite；
- Import/Export；
- Backup/Restore；
- Pi Agent 版本兼容检查；
- Durable Execution Backend 选型 Spike。

## Non-goals

Agent Waiting、真实 Feishu、生产 Tool、Active Memory、完整 Builder。

## 自动化验收

运行：

```bash
make verify-m1
```

验收程序必须自动执行：

- 100 次批量 Happy Path，检查状态泄漏和资源泄漏；
- 在每个关键持久化点注入 Worker Crash；
- 重复投递 Queue Claim、Event 和 Cancel；
- 验证每次 Retry 创建独立 Attempt，历史不被覆盖；
- SSE 断开后用事件位置恢复，检查无遗漏和无重复业务效果；
- 模拟预算耗尽、无进展、空输出、Schema 不合法；
- 验证模型能力不满足时在运行前阻断；
- Test Run 不发送生产 Output、不读生产 Secret；
- Replay 与 Version Compare 给出路径、输出和成本差异；
- 执行数据库 Backup、清空、Restore，再重跑查询；
- 对 Pi Agent 当前支持版本运行兼容契约测试；
- 对候选 Durable Execution Backend 执行等待、Signal、Timer 和重启 Spike。

## Exit Criteria

- 故障矩阵全部有确定终态；
- 自动 Retry 只发生在声明为安全的边界；
- 不存在“Tool/Model 可能已执行但平台盲目重复”的未建模路径；
- Test Case 绑定具体 Definition、Agent 和 Runtime 版本；
- Backup/Restore 通过；
- Durable Execution Spike 形成 Go/No-go 结论。

---

# M2：Interactive Agent Runtime

## 关键问题

> Agent 能否在信息不足时主动询问，并在等待数小时、进程重启和重复回复后可靠继续？

## Outcome

同一 Agent Node 支持：

```text
running → waiting → running → succeeded/failed
```

等待不依赖 Worker 内存。

## Scope

- 通过 M1 Spike 选定 Durable Execution Backend；
- `request_human_input` 平台能力；
- Interaction Request / Reply；
- Waiting、Signal、Durable Timer；
- Thread 与 Incident 基础模型；
- allowed responders、expiry、reply schema、replay protection；
- 多轮交互上限；
- If、Switch、Guard；
- 受控 Loop Region；
- Child Workflow；
- Scripted Human Reply；
- Thread 并发策略；
- Pi Agent transcript/checkpoint 的持久化或可重建恢复。

## Non-goals

完整 Feishu 产品体验、生产写 Tool、Active Memory、完整 Builder、多租户。

## 自动化验收

运行：

```bash
make verify-m2
```

使用虚拟时钟和 Channel Simulator 自动覆盖：

1. Agent 不提问，直接完成；
2. Data Analysis Agent 主动提问；
3. Algorithm Analysis Agent 主动提问；
4. 在 Waiting 时重启全部服务；
5. 同一 Reply 重放十次，只推进一次；
6. 错误 Actor、Thread、Schema 和过期 Reply 被拒绝；
7. 虚拟时钟推进到 Timeout，按定义走失败或备用分支；
8. 超过最大交互轮数时终止；
9. Waiting 状态下取消 Run；
10. Loop 达到退出条件与最大迭代限制；
11. Child Workflow 成功、失败和取消传播；
12. 同一 Thread 快速连续消息按既定策略排队或串行；
13. Context 压缩后仍保留问题、回复和关键证据。

## Exit Criteria

- Waiting 可以跨完全重启恢复；
- Duplicate Signal 不产生重复业务效果；
- 同一 Node 恢复，不动态生成伪节点；
- 所有超时和取消均有终态；
- Interaction 全流程可在 Test Mode 无人值守执行。

---

# M3：Oncall Golden Workflow Validation

## 关键问题

> 平台是否在真实或高保真 Oncall 中，比现有手工方式更快、更有证据且不会增加不可接受的误导？

## Golden Workflow

```text
Feishu Trigger
→ Normalize / Ack
→ Router / Switch
→ Data Analysis Agent ↔ Human when needed
→ Algorithm Analysis Agent ↔ Human when needed
→ Sufficiency Guard
    ├─ insufficient → 补充分析
    └─ sufficient → Output
→ Feishu Card
→ Asynchronous Memory Curation
```

## Scope

- Feishu Event、签名、去重、Ack、Card、Reply、Output；
- Incident / Thread 关联；
- Data Analysis Agent 与 Algorithm Analysis Agent；
- 只读 Tool Gateway；
- Evidence 与不确定性；
- Skill/Runbook 按需加载；
- Artifact；
- Memory Episode、Shadow Curation、离线 Retrieval Evaluation；
- 固定 Oncall Evaluation Set；
- Golden Workflow Regression Suite；
- 最低 Channel 安全边界。

## Non-goals

默认自动执行生产写操作、全面 Active Memory、通用 Marketplace、完整 Builder、企业多租户。

## 自动化验收

主命令：

```bash
make verify-m3
```

它包含两个相互独立的阶段。

### A. 确定性平台验收

```bash
make verify-m3-ci
```

自动验证：

- Feishu 签名、Replay Attack、重复事件和乱序 Reply；
- Event Simulator 的 Trigger、Ack、Interaction 和 Output；
- Tool Schema、权限、超时、Stub、Evidence 关联；
- Tool 失败不得被描述为成功；
- Skill 版本和适用范围；
- Artifact 权限、脱敏和下载策略；
- Memory Hard Gate、Quarantine、TTL、Supersede；
- Channel 用户白名单和 Thread 绑定；
- Golden Workflow 所有结构化路径。

### B. 业务价值评测

```bash
make evaluate-m3
```

在固定历史 Incident 数据集上：

- 冻结 Workflow、Agent、Skill、Prompt 和模型版本；
- 每个案例重复运行，记录波动；
- 对比人工基线或历史处理记录；
- 统计首次有效诊断时间、证据覆盖率、无效提问率、严重误导率和人工修正率；
- LLM Judge 只作为辅助信号；
- 高风险案例、Judge 分歧和随机样本进入盲化人工复核。

**限制声明**：真实业务价值和“是否误导”不能仅由自动化测试完全证明。自动化负责重复执行、收集证据和筛选风险，最终 Go/No-go 必须包含人工复核结果。

## Exit Criteria

- Golden Workflow 被真实或高保真重复使用；
- 首次有效诊断时间相对基线有明确改善；
- 关键结论可追溯到 Evidence；
- 无效提问率和严重误导率低于预设阈值；
- Memory Shadow 模式不影响主流程；
- Controlled Retrieval 只有在离线 A/B 证明正收益后才能启用。

## Pivot Criteria

- Workflow 维护成本高于收益；
- Agent 提问频繁但无信息增益；
- Evidence 无法稳定关联；
- 自动 Memory 持续降低结果质量；
- 多 Agent 分工没有优于单 Agent 或人工基线。

---

# M4：Visual Authoring and Integrated Test Mode

## 关键问题

> 不熟悉 JSON 和 Web 编程的用户，能否安全创建、理解、测试和发布 Workflow？

## Scope

- 可视化 Builder；
- Node Palette、Inspector、Mapping；
- Draft、Publish、Version Diff；
- Integrated Test Mode；
- Fixture、Mock、Human Script、Assertions；
- Run Compare、Regression Suite；
- 从失败 Run 创建 Test Case；
- Publish Gate；
- Agent Editor、Skill 选择、Tool Permission Editor；
- 可访问性和响应式查看。

## 自动化验收

运行：

```bash
make verify-m4
```

自动化浏览器场景：

- 不手写 JSON 创建 Golden Workflow 变体；
- 保存、关闭、重新打开后结构一致；
- Builder → JSON → Builder 往返无语义丢失；
- 非法连接、不可达节点、无退出 Loop 被阻断；
- Test Mode 完成 Fixture、Interaction、Assertion 和 Compare；
- 从失败 Run 创建 Test Case 并成功重现；
- 未通过 Required Suite 时无法 Publish；
- Version Diff 能解释路径、配置和权限变化；
- 关键页面做视觉回归、键盘导航和基础无障碍检查；
- 支持的浏览器组合通过同一 E2E 套件。

## Exit Criteria

- 目标用户完成 Golden Workflow 变体不需要编辑 JSON；
- UI 不生成 Runtime 无法解释的隐藏状态；
- Builder 与运行时 Schema 使用同一事实来源；
- Publish Gate 可靠阻止已知回归。

---

# M5：Small-team Beta

## 关键问题

> 多名用户、多个 Workflow 和多个 Incident 能否在明确权限与资源边界下安全共存？

## Scope

- Authentication、Workspace、RBAC；
- Secret Lifecycle；
- Sandbox、网络/文件/资源策略；
- Quota、并发、优先级；
- Audit；
- Artifact/Memory ACL；
- Retention；
- Release、Upgrade、Rollback；
- Backup/Disaster Recovery；
- 平台 SLO、自身告警和 Oncall；
- Supply-chain 与镜像来源治理。

## 自动化验收

运行：

```bash
make verify-m5
```

自动覆盖：

- 角色权限矩阵和越权尝试；
- 跨 Workspace 读取 Run、Artifact、Secret、Memory；
- Secret 创建、轮换、撤销和日志扫描；
- Sandbox 文件、网络、CPU、内存、超时和逃逸负面测试；
- Quota 与并发限制；
- Audit 不可被普通用户修改；
- Artifact 下载授权和过期；
- Retention 清理；
- 负载、队列积压和降级；
- 版本升级、数据库迁移和回滚演练；
- Backup Restore 和灾难恢复演练；
- 平台故障触发自身告警与 Runbook；
- 依赖、镜像和构建产物扫描。

## Exit Criteria

- 权限与隔离测试全部通过；
- Secret 可轮换且旧凭据失效；
- Sandbox 负面测试无越界；
- 容量限制和降级策略有效；
- 升级、回滚和恢复演练有证据；
- 平台自身有可执行 SLO 和 Oncall Runbook。

---

## 3. 阶段验收输出

每个 `make verify-mN` 必须生成：

```text
artifacts/acceptance/MN/<timestamp>/
├── report.md
├── report.json
├── test-results/
├── logs/
├── screenshots/
├── environment.json
└── support-bundle/
```

报告结论只允许：

- **GO**：全部 Blocking Gate 通过；
- **CONDITIONAL GO**：只有已批准、具备 Owner 与截止条件的非阻断问题；
- **REWORK**：关键能力未达到阶段目标；
- **PIVOT**：核心假设被证伪。

---

## 4. 当前执行顺序

```text
M0 执行闭环
→ M1 可靠性与测试基础
→ Durable Execution Spike
→ M2 Waiting / Resume
→ M3 Golden Workflow 价值验证
→ 根据证据决定 M4 / M5 投入规模
```

Memory Active Retrieval、Subagent 扩展、任意代码和完整 Builder 都不是 M0–M2 的关键路径。
