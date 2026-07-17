# Roadmap：从 Walking Skeleton 到可信 Oncall Platform

- **版本**：v0.6
- **状态**：M1 Complete / Stable
- **日期**：2026-07-17
- **当前阶段**：M1 已完成并达到 Stable；下一独立 Goal 为 M2，不自动开始

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

#### Scope

- PostgreSQL；
- WorkflowDefinitionVersion；
- WorkflowRun / NodeRun；
- Run history；
- 页面刷新和服务重启后历史存在；
- 简单 migration。

#### Functional Gate

- [x] History 从重启后的服务中仍可找到同一历史 Run 与其 Definition v1；
- [x] 从 History 打开 v1 Run 时，Board 只显示该 Run 固定 Definition v1 的节点；
- [x] Run、Attempt、Agent Execution 快照和 Fake 输出在重启前后保持不变。

验证记录：2026-07-17 在分支 `codex/m1b-persistent-history`、实现基线 `e20cbbd2e7e99e44c863b1fd3cfc60a6335c18ac` 上通过。持久化基础能力不是本次重做范围；最小修复让 Run Detail 直接使用该 Run 不可变的 `WorkflowDefinitionVersion.definition` 渲染 Board，消除后续导入 v2 时历史 v1 Run 显示 v2 节点的漂移。未新增 schema、migration 或 endpoint。

### M1-C：Execution Events（Verified）

#### Functional Gate

- [x] append-only `ExecutionEvent` 投影为按 sequence 排序的 Run Timeline；
- [x] 采用可靠 polling；一次临时 Detail 请求失败后自动恢复，未提前引入 SSE；
- [x] `artifact.created` 只保存 Output Markdown 的安全 metadata reference（source、SHA-256、media type、字节数、sensitivity、retention policy），不复制 Markdown、Prompt、Provider 或 Secret；
- [x] metadata 从实际 Output Node ID 派生，不假设 seed 的 `result` ID；
- [x] cursor/resume 仍留在 M2。

验证记录：2026-07-17 在分支 `codex/m1c-events-hardening`、实现基线 `585b7a6e7fe3ae570cae95bfef03b751871dc5e7` 上通过。成功 Run 产生 12 条持久化 Timeline 事件，其中 `artifact.created` 引用 canonical PostgreSQL Markdown Output；Timeline 只投影安全字段。真实 Compose Chromium E2E 覆盖离开页面后 Run 仍完成、一次 polling 失败后的恢复，以及非默认 Output Node ID，3/3 通过。

### M1 Hardening Gate（Stable）

- [x] Definition、Board、Run 的不可变引用保持一致，M1-B History 回归继续通过；
- [x] migration ledger 记录并跳过已应用迁移；`005_execution_events_timeline.sql` 在 artifact Run 后重复执行 Compose migrate 仍成功；
- [x] 关键 Run History / Timeline 查询由 runtime、crash/restart 与浏览器回归覆盖；
- [x] Timeline、artifact metadata、错误与 provider snapshot 不泄漏 Prompt、Markdown、Provider 配置、Secret 或内部执行 ID；
- [x] 真实 Run 可在浏览器离开页面后由 Worker 完成，再从 History 打开并读取 Output 与 Timeline。

验证汇总：`pnpm typecheck` PASS；`pnpm test:e2e -- test/e2e/m1c-events-hardening.spec.ts` 3 passed；`test/runtime/async-happy-path.system.sh` PASS；`test/failure/failure-crash-restart.system.sh` PASS；`pnpm test:e2e -- test/e2e/m1b-persistent-history.spec.ts` 1 passed；`pnpm test:e2e -- test/e2e/m1a-flowgram-board.spec.ts` 2 passed；`git diff --check` PASS。in-app Browser 手工验收未完成：两个 isolated Codex agent runtimes 均返回 `iab unavailable/list []`，因此没有 IAB screenshot；此处仅声明真实 Compose Chromium E2E 已通过，不将其表述为 IAB 验收。

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

M1 已完成并达到 Stable；当前 Goal 到此停止。下一独立 Goal 为 M2：Durable Execution，不自动开始。

在 M2 Goal 明确开始前，不推进：

- Durable Runtime / M2；
- FlowGram Authoring；
- 全量文档同步；
- 完整验收平台。
