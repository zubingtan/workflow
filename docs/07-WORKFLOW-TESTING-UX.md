# Product & Engineering Design：Workflow Testing UX

- **版本**：v0.6
- **状态**：Active Testing Policy / Future Product Design
- **日期**：2026-07-17

## 1. 本版核心修正

平台需要完整测试能力，但当前工程不采用“所有实现必须严格 test-first”的方式。

统一策略：

```text
真实行为先形成
→ 核心契约得到保护
→ Bug 添加 Regression
→ 高风险能力完成 Hardening
```

测试的目标是降低真实风险，而不是制造进度表象。

## 2. 工程测试分类

### 2.0 Delivery automation 分层

日常 PR 只执行 `pnpm typecheck` 和 `pnpm test:fast`：Doctor、health、runtime boundary、definition compiler/projection 与 provider-failure 的无数据库、无浏览器契约。`test:integration` 覆盖 workflow/run/terminal-failure 的数据库集成；`test:release-tools` 覆盖 bootstrap、evidence、governance 与 release 静态契约。Compose、Chromium、Docker 与 Evidence Bundle 仅由 `make verify-m0` 的发布验收执行。

可用 `git diff --name-only <base>...HEAD | pnpm test:changed` 输出确定性的建议风险层和命令；它不自动执行重型测试。`make install-hooks` 才会启用本仓库 pre-push hook，该 hook 仅运行 typecheck 和 `test:fast`。

### 2.1 Contract Test

用于稳定边界：

- Workflow Definition validation；
- Compiler；
- Adapter normalization；
- Projection mapping；
- Provider error mapping；
- public API contract。

### 2.2 Integration Test

用于跨模块行为：

- Run API → Runtime → Agent → Output；
- Persistence；
- Event；
- Tool Gateway；
- Interaction resume；
- Channel dedup。

### 2.3 Regression Test

复现并保护已发生 Bug。优先级最高。

### 2.4 Smoke Test

证明核心用户路径可以运行。每个 Functional Gate 至少一个。

### 2.5 E2E Test

只覆盖最关键、跨浏览器或高价值路径。不要用大量脆弱 E2E 代替低层测试。

## 3. 何时适合 Test-first

- parser/compiler；
- 状态机；
- migration；
- idempotency；
- retry policy；
- security/redaction；
- 已有明确输入输出契约；
- 修复已复现 Bug。

## 4. 何时不强制 Test-first

- 首次 UI composition；
- 新框架集成 Spike；
- 样式和交互探索；
- 简单 API wiring；
- 当前纵向切片首次打通；
- 快速验证第三方依赖兼容性。

这些场景先实现并真实运行，再为稳定下来的行为添加 smoke/contract。

## 5. 明确禁止的低价值测试

除非它们本身是正式发布契约，否则不要测试：

- C++/TS/Python 源文件是否存在；
- 目录是否存在；
- README 是否包含某个标题；
- 简单 DTO 能否构造；
- getter/setter；
- 常量；
- 框架默认路由行为；
- React 组件存在；
- 尚未实现的接口；
- 未来数据库表的占位模型；
- 为覆盖率创建的无风险分支；
- 大量 UI snapshot；
- mock 调用了 mock。

## 6. 当前 M0 测试预算

M0 Functional Gate 推荐：

1. 一个 Runtime 或 Agent Adapter 核心测试；
2. 一个 `POST Run → result` integration test；
3. 一个 Web/API smoke test。

不是硬性数量上限；但新增测试必须能回答：

- 它保护哪个用户行为？
- 它保护哪个不可逆契约？
- 它复现哪个真实 Bug？
- 不写会产生什么具体风险？

答不出来就不应成为当前 Goal。

## 7. 测试顺序

当前切片：

```text
运行现有系统
→ 实现产品行为
→ 手动/浏览器验证
→ 添加核心 integration/smoke
→ 修复缺陷并补 regression
→ 结束
```

M2 Durable Hardening：

```text
定义恢复语义
→ 故障测试先行
→ 实现 Attempt/Retry/Recovery
→ 并发和故障注入
```

不同风险阶段使用不同测试强度。

## 8. 产品 Test Mode

M4 提供独立 Test Mode：

- 使用同一 Definition；
- 使用同一 Compiler；
- 使用同一 Workflow Runtime 语义；
- 替换外部副作用；
- 展示 Test Overlay；
- 保存 TestCase 和结果。

### 标准替身

- Fake Provider；
- Tool Stub；
- Scripted Human Reply；
- Test Clock；
- Channel Simulator；
- Output Sink。

## 9. TestCase

```ts
interface WorkflowTestCase {
  id: string
  workflowDefinitionVersionId: string
  input: JsonValue
  providerFixture?: JsonValue
  toolFixtures?: JsonValue
  humanScript?: JsonValue
  expectedPath?: JsonValue
  expectedOutput?: JsonValue
  assertions: TestAssertion[]
}
```

### Assertions

优先：

- deterministic value；
- schema；
- path；
- status；
- evidence presence；
- no side effect；
- version binding。

Semantic Evaluation 只能作为补充，不是唯一 Gate。

## 10. Failure-to-Test Workflow

M4 支持：

```text
Failed Run
→ Select relevant input/events/artifacts
→ Redact
→ Replace external effects with fixtures
→ Create TestCase
→ Review expected behavior
→ Add to regression suite
```

## 11. Publish Gate

发布新 Workflow Version 前可要求：

- Static Validation；
- required TestCases；
- no forbidden Tool；
- schema compatibility；
- reviewer；
- risk-specific checks。

Publish Gate 的严格程度随风险等级变化；普通本地 Draft 不需要生产级 Gate。

## 12. Testing UX

Design/Test/Run 使用同一画布和节点位置：

- Design：配置；
- Test：fixture、expected、assertion；
- Run：真实状态、input/output/error/evidence。

模式切换改变 Overlay，不改变业务 Definition。

## 13. 测试质量指标

有意义的指标：

- 真实 Bug 回归率；
- 关键路径故障发现率；
- flaky rate；
- 测试执行反馈速度；
- 高风险边界覆盖；
- 发布 Gate 发现的有效问题。

不使用：

- 测试文件数量；
- assertion 数量；
- 100% coverage 作为单一目标。
