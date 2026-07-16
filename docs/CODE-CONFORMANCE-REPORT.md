# Current Code Baseline：M0 Functional Gate Verified

- **文档版本**：v0.6
- **状态**：Verified
- **日期**：2026-07-17
- **目标分支**：`codex/v0.6-m0-web-run`
- **验证实现基线**：`5368891fe35c840ed1185669770d0d09ae7db2f5`

## 1. 验证结论

M0 Web Run 纵向闭环已在本地真实环境验证，结果为 `VERIFIED`。现有实现满足本 Goal 的停止条件，没有发现需要修改产品代码的缺口或阻断。本 Goal 到此停止，不进入 M1-A。

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

## 5. Goal 结果

```text
Ref/Commit: codex/v0.6-m0-web-run / 5368891fe35c840ed1185669770d0d09ae7db2f5
Startup command: WORKFLOW_ENV_FILE=.env.example docker compose --env-file .env.example up -d
Web URL: http://localhost:3000
Workflow used: M0 Bootstrap Workflow / seed-workflow-v1
Provider: fake-default / fake-m0
Observed user path: 打开 seed Workflow → 确认 Input/Agent/Output → 输入 Prompt → Run → 查看状态与输出 → Run again
Tests run: readiness, make smoke-test, Browser happy path and Run again, independent API double run, pnpm typecheck
M0 Functional Gate: VERIFIED
Remaining blocker: none
```

## 6. 进入 M1 的判断

M0 Functional Gate 已真实可运行。M1-A 可以作为下一独立 Goal 创建，但不在本 Goal 中开始。

无需等待：

- Crash Recovery；
- Evidence Bundle；
- 完整 Test Matrix；
- FlowGram；
- M2 Durable Hardening。
