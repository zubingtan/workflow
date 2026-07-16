# Roadmap：从 Walking Skeleton 到可信 Oncall Platform

- **版本**：v0.6
- **状态**：M1-A Functional Gate Verified
- **日期**：2026-07-17
- **当前阶段**：M1-A Functional Gate 已验证；本 Goal 停止，不自动进入 M1-B

## 1. Roadmap 设计

Roadmap 按风险和用户价值排序，而不是按组件数量排序。

每个里程碑有两个门：

### Functional Gate

用户可以完成该阶段的核心任务。优先交付。

### Hardening Gate

关键失败、安全、恢复、回归和运维能力达到进入下一风险等级的要求。

允许在 Functional Gate 后开发下一个低风险功能切片；但在以下情况前必须完成对应 Hardening Gate：

- 对外稳定发布；
- 接入真实 Channel；
- 执行生产写 Tool；
- 支持长时间 Waiting；
- 开放多人团队；
- 自动执行代码。

## 2. 阶段总览

| 阶段 | 用户价值 | 主要风险 |
|---|---|---|
| M0 | 本地运行一个 Agent Workflow | 基础集成 |
| M1 | 看见真实 Workflow、历史和执行过程 | Definition/Projection/State |
| M2 | 长时运行、失败恢复、重试取消 | Durable Execution |
| M3 | 完成真实 Oncall Golden Workflow | Tool/Human/Channel/Evidence |
| M4 | 用户可视化创建、测试和发布 Workflow | Authoring Correctness |
| M5 | 小团队安全使用、Memory 和生产化 | Security/Governance/Operations |

## 3. M0：Local Workflow Walking Skeleton

### Goal

```text
打开 Web
→ 输入 Prompt
→ 运行 Input → Agent → Output
→ 查看状态与结果
```

### Functional Scope

- Docker 或单命令启动；
- Web + API；
- 一个 JSON seed Workflow；
- `input.prompt`；
- `process.agent`；
- `output.markdown`；
- Fake Provider；
- 可选真实 Provider；
- Run ID 和状态；
- 结果/错误展示；
- README。

### Functional Gate

- [x] 新环境按 README 启动；
- [x] 页面可打开；
- [x] 页面能理解为三节点 Workflow；
- [x] 用户可输入 Prompt；
- [x] 点击 Run 后状态变化；
- [x] Output 展示结果；
- [x] Fake Provider 不依赖外部凭证；
- [x] 一个 smoke/integration test 通过。

验证记录：2026-07-17 在分支 `codex/v0.6-m0-web-run`、实现基线 `5368891fe35c840ed1185669770d0d09ae7db2f5` 上通过真实 Web Run、Run again、API 双运行、smoke 与 typecheck。未发现产品代码缺口或阻断。

### Hardening Scope

只做当前阶段必要内容：

- 基础输入校验；
- 结构化错误；
- Secret 不下发前端；
- 启动健康检查；
- 一个真实 Bug 的 regression test。

### Non-goals

- FlowGram；
- PostgreSQL durable queue；
- Worker lease；
- crash recovery；
- Event stream；
- retry/cancel；
- Builder；
- Evidence Bundle。

### Exit

M0 Functional Gate 已通过；历史 Goal 已在此停止并完成 Review。

## 4. M1：Workflow Visibility and Persistence

### M1-A：FlowGram Board Vertical Slice

#### Goal

把真实 JSON Definition 和 Run 状态投影到 FlowGram：

```text
Definition
→ FlowGram Board
→ Prompt
→ Run
→ Node Status Overlay
→ Output
```

#### Scope

- FlowGram Free Layout；
- Definition → Visual Projection；
- stable node ID；
- 三节点两条边；
- 节点详情；
- Run 状态 Overlay；
- Canvas failure isolation；
- 不写回 Definition。

#### Functional Gate

- [x] 用户在同一页面看到真实 Workflow 和 Run；
- [x] 节点状态对应当前 Run；
- [x] 点击节点可查看输入/输出/错误；
- [x] Canvas 不是 mock 数据；
- [x] 后端 Run 在 Canvas 故障时仍可工作。

验证记录：2026-07-17 在分支 `codex/m1-a-flowgram-board`、实现基线 `3bb24c1f8f0856120aadde18a0f7ff333143e3ad` 上通过。真实 Definition 投影为三个稳定产品节点 ID、两条边的只读 FlowGram Free Layout Board；正常 Chromium E2E 验证无 fallback、节点选择、同页 Run、三节点成功、Fake 输出与干净 console。受控 Canvas failure 仅在 Playwright 的 `navigator.webdriver` 加 preload global 条件下触发，显示 source Definition list，同时同页真实 Run 仍成功。

#### Hardening

- Projection contract test；
- 锁定依赖；
- 关键浏览器 smoke；
- Hash/Version 在引入 DefinitionVersion 后一致。

### M1-B：Persistent Run History

- PostgreSQL；
- WorkflowDefinitionVersion；
- WorkflowRun / NodeRun；
- Run history；
- 页面刷新和服务重启后历史存在；
- 简单 migration。

### M1-C：Execution Events

- append-only ExecutionEvent；
- Run timeline；
- SSE 或可靠 polling；
- cursor/resume 可延后到 M2；
- Artifact metadata。

### M1 Hardening Gate

- Definition、Board、Run 引用一致；
- migration 可重复；
- 关键历史查询有 integration test；
- Secret 和错误脱敏；
- 真实 Run 不依赖浏览器生命周期。

## 5. M2：Durable Execution

### Goal

Workflow 可以跨进程、重启、等待和失败恢复。

### Scope

- 独立 Worker；
- queue / claim；
- NodeRunAttempt；
- retry；
- timeout；
- cancel；
- lease / heartbeat 或 Durable Engine；
- crash recovery；
- idempotency；
- outcome_unknown；
- waiting/resume；
- event cursor；
- state-event consistency。

### Functional Gate

- Worker 被终止后 Run 有明确恢复或失败结果；
- Retry 产生新 Attempt；
- Cancel 可见且持久化；
- 等待中的 Workflow 可恢复；
- 重复投递不产生重复成功输出。

### Hardening Gate

- 故障注入；
- migration/rollback；
- 并发 claim；
- retry policy；
- secret scan；
- support bundle；
- 稳定性重复验证。

### Spike

比较：

- PostgreSQL Queue；
- Temporal；
- 其他 Durable Backend。

选择必须基于当前 Workflow 语义、运维成本和恢复需求。

## 6. M3：Oncall Golden Workflow

### Goal

完成首个真实业务闭环：

```text
Feishu Trigger
→ Context
→ Specialist Agents
→ Tool/Evidence
→ Human Input
→ Guard/Loop
→ Report
→ Feishu Card
```

### Scope

- Tool Gateway；
- Read/Draft Tool；
- Evidence；
- Human Interaction；
- Approval；
- Controlled Loop；
- Feishu Adapter；
- Dedup/Correlation；
- Golden Workflow；
- business evaluation。

### Functional Gate

- 一个真实 Issue 可以从 Channel 触发；
- Agent 缺信息时等待用户；
- Tool 输出形成 Evidence；
- 最终 Card 有结论、证据和不确定性；
- 相同事件不重复创建 Run。

### Hardening Gate

- OAuth/identity；
- tool policy；
- idempotency；
- interaction timeout；
- audit；
- golden test set；
- production side-effect safety。

## 7. M4：Workflow Builder and Test Studio

### Scope

- FlowGram Authoring；
- Palette；
- Typed Ports；
- Inspector；
- Draft/Publish；
- Validation diagnostics；
- Version diff；
- TestCase；
- Fixture；
- Replay/Compare；
- Regression；
- Publish Gate；
- Design/Test/Run 统一视觉语言。

### Functional Gate

非核心开发者可以：

- 修改 Golden Workflow；
- 运行 Test；
- 理解失败；
- 发布新 Version；
- 回滚。

### Hardening Gate

- authoring command validation；
- optimistic locking；
- round-trip semantic consistency；
- migration compatibility；
- publish permission；
- test isolation。

## 8. M5：Team, Memory and Production

### Scope

- Auth / Workspace / RBAC；
- Audit；
- Secret Lifecycle；
- Artifact access/retention；
- Reviewed Memory；
- Shadow/A-B/Kill Switch；
- quota/cost；
- sandboxed code；
- production SLO；
- backup/recovery；
- support tooling。

### Exit

平台可以供小团队长期运行，且 Memory、Tool、代码执行和团队权限都有明确安全边界。

## 9. 当前进度口径

统一状态：

- **Planned**：文档存在；
- **Implemented**：代码存在；
- **Demonstrated**：真实用户路径运行成功；
- **Verified**：关键自动测试通过；
- **Stable**：Hardening Gate 通过。

不使用“完成百分比”。

## 10. 当前下一目标

M1-A Functional Gate 已验证完成；当前 Goal 到此停止。下一独立 Goal 为 M1-B：Persistent Run History，不自动开始。

在 M1-B Goal 明确开始前，不推进：

- M1-C Event；
- Durable Runtime；
- 全量文档同步；
- 完整验收平台。
