# Codex Goal：完成 M0 Web Run 纵向闭环

你正在本地维护 `zubingtan/workflow`。

进入 Goal 模式。本次只完成一个用户可见结果：

```text
用户启动项目
→ 打开 Web
→ 看见 Input / Agent / Output Workflow
→ 输入 Prompt
→ 点击 Run
→ Agent 执行
→ 页面显示状态和最终结果
```

不要在本次 Goal 中推进 FlowGram、M1、Durable Runtime 或完整验收平台。

## 1. 文档阅读范围

只需阅读：

1. `README.md`
2. `04-ROADMAP.md` 的 M0
3. 本文件

只有遇到架构边界问题时再查：

- `02-DESIGN-DOC.md`
- `03-ADR.md`

不要先阅读和同步全部文档。

## 2. 建立分支

从当前合适分支或 `m0-v0.1.0` 创建工作分支：

```bash
git status --short
git rev-parse HEAD
git describe --tags --always
git switch -c codex/v0.6-m0-web-run
```

若分支已经存在，继续使用，不要重复创建。

## 3. 第一动作：运行当前系统

先检查仓库已有：

- README；
- package manager；
- Docker Compose；
- Makefile；
- Web 入口；
- API 入口；
- Workflow Definition；
- Agent/Provider Adapter。

然后使用现有命令启动系统。

不要先：

- 写新测试；
- 更新文档；
- 建立 Requirement Matrix；
- 设计数据库；
- 重构目录；
- 添加未来接口。

直接尝试完成一次真实 happy path。

## 4. 当前唯一范围

必须实现或修复：

### Startup

- 一个明确命令可以启动；
- 启动错误可理解；
- `.env.example` 无真实 Secret；
- Fake Provider 默认可用。

### Workflow View

页面清楚显示：

```text
Input → Agent → Output
```

M0 可以使用简单 HTML/CSS/React 组件，不要接入 FlowGram。

Workflow 结构应来自一个服务端或共享 JSON Definition，避免前端、后端各自维护不同节点语义。

### Run

- Prompt 输入；
- Run 按钮；
- 创建 Run ID；
- pending/running/succeeded/failed；
- Agent 通过现有 Runtime Adapter 或 Fake Adapter 执行；
- 结果传给 Output；
- 失败显示结构化错误；
- 页面不能无限 loading。

### Result

- Markdown 或 Text 结果；
- 当前 Run 状态；
- 最基本的输入/输出；
- 可以再次运行。

## 5. 允许的阶段性简化

本 Goal 可以：

- 单进程执行；
- 内存保存 Run；
- polling；
- 一个 seed Workflow；
- 一个 Fake Provider；
- 一个简单页面；
- 单次 Attempt；
- 只支持一个用户。

保留以下边界即可：

- Web 不直接调用 Provider；
- Agent 经 Adapter/Port；
- Run 有独立 ID；
- Workflow 由 JSON Definition 表达；
- Secret 仅服务端；
- 状态存取不要散落到所有组件。

不要为了未来 M2 提前建设复杂基础设施。

## 6. 明确禁止

本次不要实现：

- FlowGram；
- Workflow Builder；
- PostgreSQL queue；
- Worker lease；
- NodeRunAttempt；
- ExecutionEvent；
- SSE Resume；
- Retry/Cancel；
- Crash Recovery；
- Human Interaction；
- Feishu；
- Tool Gateway；
- Memory；
- Evidence Bundle；
- Support Bundle；
- 完整 Requirement Matrix；
- 连续多次 clean verification；
- 全量文档重写；
- 无关重构。

## 7. 测试策略

不采用严格 test-first。

先让纵向路径工作，再补最少必要测试。

本次测试优先：

1. 一个 `create run → agent → output` integration test；
2. 一个 Web 或 API smoke test；
3. 已发现 Bug 的 regression test。

不要测试：

- 源文件是否存在；
- 目录是否存在；
- README 标题；
- 简单 DTO/getter；
- React 组件是否定义；
- 框架默认行为；
- 尚未实现的未来接口；
- 只为覆盖率的代码。

已有有效测试应保留并运行相关部分，不要为了本 Goal 修复无关历史测试。

## 8. 工作方式

按以下顺序：

```text
运行现状
→ 找到第一个阻塞
→ 修复最小产品代码
→ 浏览器/API 验证
→ 继续下一个阻塞
→ happy path 完成
→ 添加最小测试
→ 更新 README
→ 停止
```

每次修改优先最小、直接、可逆。

不要因为看到潜在架构优化就扩大范围。

## 9. 文档更新

完成后只更新：

- `README.md`：真实启动和使用步骤；
- `04-ROADMAP.md`：M0 状态；
- `CODE-CONFORMANCE-REPORT.md`：轻量实际结果。

只有当领域模型或关键架构决策真正变化时，才更新 Design/ADR。

不要更新其他文档。

## 10. 停止条件

以下全部满足后立即停止：

- [ ] 项目可启动；
- [ ] Web 可打开；
- [ ] 页面显示 Input / Agent / Output；
- [ ] 用户可输入 Prompt；
- [ ] 点击 Run 后状态变化；
- [ ] Fake Agent/Provider 执行；
- [ ] Output 显示结果；
- [ ] 错误不会导致无限 loading；
- [ ] 一个核心 integration/smoke 通过；
- [ ] README 可复现。

完成后不要自动进入 M1-A，不要“顺便”补更多测试或架构。

## 11. Git

检查：

```bash
git status
git diff --check
```

创建与实际工作对应的少量提交，例如：

```text
fix(app): complete local workflow run path
feat(web): show workflow status and output
test(run): cover minimal happy path
docs: document m0 local run
```

不要 push、创建 PR、发布 Release 或修改远端 tag，除非用户明确授权。

## 12. 最终汇报

只输出：

### Goal Result

`DEMONSTRATED / VERIFIED / BLOCKED`

### User-visible Behavior

现在用户可以完成什么。

### Files Changed

关键文件及用途。

### Commands Run

实际命令和结果。

### Tests

新增或运行的必要测试。

### Remaining Issues

最多三个，不写完整未来 Roadmap。

### Next Goal

只写：

```text
M1-A: FlowGram read-only Workflow Board with Run overlay
```

现在开始执行。不要先写测试和文档；先运行产品。
