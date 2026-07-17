# Current Code Baseline：M0、M1-A 与 M1-B Functional Gates Verified

- **文档版本**：v0.6
- **状态**：Verified
- **日期**：2026-07-17
- **目标分支**：`codex/m1b-persistent-history`
- **验证实现基线**：`e20cbbd2e7e99e44c863b1fd3cfc60a6335c18ac`

## 1. 验证结论

M0 Web Run 纵向闭环已在本地真实环境验证，结果为 `VERIFIED`。其历史证据保留在本文第 4 节。

M1-A FlowGram read-only Workflow Board with Run overlay 已在本地真实环境验证，结果为 `VERIFIED`。现有实现满足该 Goal 的停止条件：真实 Definition 被投影到只读 FlowGram Board，Run 与节点状态在同页显示，Canvas failure 不影响后端 Run。

M1-B Persistent Run History 已在本地真实 Compose 环境验证，结果为 `VERIFIED`。本次不是重做 PostgreSQL、DefinitionVersion、Run History 或重启恢复能力；最小修复让 Run Detail 使用其固定、不可变的 `WorkflowDefinitionVersion.definition` 渲染 Board，消除了导入 v2 后历史 v1 Run 显示 v2 节点的漂移。未新增 schema、migration 或 endpoint。本 Goal 到此停止，不进入 M1-C、M2 或 FlowGram Authoring。

## 2. 轻量基线原则

不要先创建全量 Requirement Matrix。只确认完成当前 Goal 所需的事实：

| 问题 | 结果 | 证据 |
|---|---|---|
| 项目如何启动？ | Verified | `WORKFLOW_ENV_FILE=.env.example docker compose --env-file .env.example up -d`；五服务健康，migration exit 0 |
| Web 入口在哪里？ | Verified | `http://localhost:3000`，readiness 返回 ready |
| API 入口在哪里？ | Verified | Web/API 服务栈可用；独立 API 双运行均返回 202 并成功结束 |
| 当前 Workflow Definition 在哪里？ | Verified | seed `M0 Bootstrap Workflow` / `seed-workflow-v1` |
| Agent Runtime 如何调用？ | Demonstrated | `input.prompt` → `process.agent` → `output.markdown` 的真实 Run |
| Fake Provider 是否存在？ | Verified | `fake-default` / `fake-m0`，无需外部凭证 |
| Run 状态在哪里？ | Demonstrated | Web 与 API 均观察到 `queued` → `succeeded`，节点终态均为 `succeeded` |
| happy path 是否工作？ | Verified | Browser Run、Run again、API 双运行、smoke 均通过 |
| 当前阻塞是什么？ | Verified | 无产品代码缺口或阻断 |

本地 Codex 只需填充这些项目，不需要为每个文件和未来 Requirement 创建矩阵。

## 3. 代码状态

对能力使用：

- Unknown
- Implemented
- Demonstrated
- Verified
- Blocked

### M0 Functional Gate

| Capability | Status | Notes |
|---|---|---|
| startup | Verified | pnpm 11.13.0；Docker Engine 29.6.1 / Docker VMM；PostgreSQL 18.4；五服务健康 |
| Web page | Verified | `http://localhost:3000` 可打开；无框架错误层；Browser console error/warn 为空 |
| workflow view | Demonstrated | 页面显示 Input / Agent / Output 三节点及正确类型 |
| prompt input | Demonstrated | Browser 输入 Prompt 并创建 Run |
| run action | Verified | 两次 Browser Run 与两次独立 API Run 均成功；Run ID 各不相同 |
| agent execution | Verified | 所有运行均由 `queued` 到 `succeeded`，节点错误为空 |
| output display | Demonstrated | Output 显示 `Fake provider response` |
| fake provider | Verified | 使用 `.env.example` 的 `fake-default` / `fake-m0` 验证，无外部凭证 |
| smoke/integration | Verified | `make smoke-test` PASS；`pnpm typecheck` PASS；独立 API 双运行 PASS |
| README reproduction | Verified | 现有启动路径可复现；根 README 无需修改 |

### M1-A Functional Gate

| Capability | Status | Notes |
|---|---|---|
| FlowGram dependency | Verified | 官方 `@flowgram.ai/free-layout-editor` 锁定为 `1.0.12` |
| Definition projection | Verified | 真实 Definition 投影为三节点、两条边，保留稳定产品节点 ID |
| read-only board | Verified | 不写回业务 Definition，未引入 Authoring |
| Run overlay and Node Detail | Demonstrated | Workflow 页面同页 Run/poll；节点详情展示真实输入、输出或错误 |
| normal browser path | Verified | Chromium E2E 验证真实 Board、无 fallback、节点选择、同页 Run、三节点成功、Fake 输出与干净 console |
| Canvas failure isolation | Verified | 仅在 Playwright `navigator.webdriver` 与 preload global 受控条件下触发 fallback source Definition list；同页真实 Run 仍成功 |
| M0 regression | Verified | M0 focused regression PASS |

### M1-B Functional Gate

| Capability | Status | Notes |
|---|---|---|
| immutable Run Definition rendering | Verified | Run Detail 使用该 Run 的 `WorkflowDefinitionVersion.definition` 渲染 Board，不再重新请求最新 Workflow Definition |
| historical version consistency | Verified | 导入 v2 后，从 History 打开 v1 Run 只显示 v1 节点 ID 与 Definition v1 |
| restart persistence | Demonstrated | Compose restart 后 History 仍有同一 v1 Run/Definition v1；Run、Attempt、Agent Execution 快照与 Fake 输出不变 |
| runtime integration | Verified | v1/v2 漂移 RED→GREEN，12/12 PASS |
| browser regression | Verified | M1-B Chromium 真实 Compose restart E2E PASS（78s，console clean）；相邻 M1-A 与 M0 E2E 亦通过 |

## 4. 真实验证记录

### Environment and startup

- pnpm：`11.13.0`
- Docker：Engine `29.6.1`，Docker VMM
- PostgreSQL：`18.4`
- 启动：`WORKFLOW_ENV_FILE=.env.example docker compose --env-file .env.example up -d`
- 服务：五服务 healthy，migration exit 0
- Web：`http://localhost:3000`
- Readiness：application/database 均为 ready

### Browser happy path

- Workflow：`M0 Bootstrap Workflow` / `seed-workflow-v1`
- Provider：`fake-default` / `fake-m0`
- Run 1：`run-5f8b8fbb-6719-4384-9e7f-6e590f06c3ff`
- Run again：`run-f72931c5-cfba-44b3-83f5-71c9f51c96f5`
- 两次运行终态均为 `succeeded`，Run ID 不同
- 三节点依次为 Input `prompt/input.prompt`、Agent `analysis/process.agent`、Output `result/output.markdown`，终态均为 `succeeded`
- 最终输出：`Fake provider response`
- Run 与节点错误为空；Browser console error/warn 为空
- 窄屏检查无文档横向溢出

### Independent API path

- Run 1：`run-1f548b16-aec5-4909-b81f-40e185caf2ea`
- Run 2：`run-24fd52cb-e320-4a90-bfaa-1b044362abb5`
- 两次 POST 均返回 202，均观察到 `queued` → `succeeded`
- 三节点顺序、类型、终态和输出正确；Run/Node 错误均为 null

### Checks

- `make smoke-test`：PASS
- `pnpm typecheck`：PASS
- 产品代码修改：无
- 阻断：无

## 5. M1-A 真实验证记录

### Implementation and runtime

- Ref/Commit：`codex/m1-a-flowgram-board` / `3bb24c1f8f0856120aadde18a0f7ff333143e3ad`
- FlowGram：官方 `@flowgram.ai/free-layout-editor@1.0.12`
- Board：真实 Definition 投影为只读 Free Layout；三节点、两条边、稳定产品节点 ID；无 Definition 写回或 Authoring
- Workflow page：同页 Run/poll overlay 与 Node Detail；Run 使用现有真实后端路径
- Runtime：Docker app rebuilt，服务 healthy，readiness 为 ready

### Browser and regression checks

- projection Vitest：PASS
- `pnpm typecheck`：PASS
- 三个 Chromium Playwright E2E：PASS
- 正常路径：真实 FlowGram Board、无 fallback、节点选择、同页 Run、三节点 `succeeded`、`Fake provider response`、console 干净
- 受控 Canvas failure：仅在 Playwright `navigator.webdriver` 与 preload global 条件下触发，无公开 query；页面显示 source Definition list，同时同页真实 Run 成功
- M0 focused regression：PASS

## 6. M1-A Goal 结果

```text
Ref/Commit: codex/m1-a-flowgram-board / 3bb24c1f8f0856120aadde18a0f7ff333143e3ad
Workflow board: official @flowgram.ai/free-layout-editor@1.0.12, read-only real Definition projection
Observed user path: 打开 Workflow → 查看三节点两条边 → 选择节点查看详情 → 同页 Run → 查看节点状态 Overlay 与 Fake 输出
Failure isolation: controlled Playwright-only Canvas failure shows source Definition fallback; Run remains available and succeeds
Tests run: projection Vitest, pnpm typecheck, three Chromium Playwright E2Es, M0 focused regression
M1-A Functional Gate: VERIFIED
Remaining blocker: none
```

## 7. M1-B 真实验证记录

```text
Ref/Commit: codex/m1b-persistent-history / e20cbbd2e7e99e44c863b1fd3cfc60a6335c18ac
Change: Run Detail 的 Board 直接渲染 Run 固定且不可变的 WorkflowDefinitionVersion.definition
Regression fixed: 导入 v2 后，历史 v1 Run 不再显示 v2 节点
No new persistence surface: no schema, migration, or endpoint
Runtime integration: v1/v2 RED→GREEN, 12/12 PASS
Browser: M1-B Chromium real Compose restart E2E PASS (78s); after restart History retains the same v1 Run/Definition v1; opening it shows only v1 node IDs, and Run/Attempt/Execution snapshots plus Fake output are unchanged; console clean
Adjacent regression: M1-A and M0 E2E PASS
M1-B Functional Gate: VERIFIED
Remaining blocker: none
```

## 8. 文档基线说明

`docs/SHA256SUMS` 与 `docs/MANIFEST.json` 保留 v0.6 来源包的原始基线记录；本次仅更新本地状态记录文件，不将这些来源包校验值声明为当前状态记录内容的校验结果。

## 9. 后续阶段判断

M1-B Functional Gate 已真实可运行。本 Goal 在此停止；M1-C、M2 与 FlowGram Authoring 均须作为后续独立 Goal 再决定与开始。
