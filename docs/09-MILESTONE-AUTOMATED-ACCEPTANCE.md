# Specification：Milestone Functional and Hardening Acceptance

- **版本**：v0.6
- **状态**：Active Acceptance Policy
- **日期**：2026-07-17

## 1. 目的

PR Gate 只验证类型检查和快速产品契约，不启动 PostgreSQL、Docker 或 Chromium，也不上传 artifact。`make verify-m0` 是 release-only 的完整 M0 验收入口，继续执行 integration、release-tools、Compose system、E2E 与 sealed evidence。

验收用于确认用户能力和风险边界，而不是强迫每个实现步骤先建设测试基础设施。

本规范取代此前“所有里程碑一开始就要求完整 Evidence Bundle、全量矩阵和连续多次 clean verification”的方式。

## 2. 验收层级

### Level 1：Demonstrated

真实用户路径可以运行，并能观察结果。

### Level 2：Verified

核心行为由相关自动测试保护。

### Level 3：Stable

对应 Hardening Gate 通过，可进入更高风险部署或稳定发布。

## 3. Functional Gate

Functional Gate 必须回答：

- 用户能完成什么？
- 输入是什么？
- 输出是什么？
- 失败时用户看到什么？
- 如何从干净环境复现？

允许使用：

- 浏览器实际操作；
- API smoke；
- 一个 integration test；
- 简短截图或日志；
- README 步骤。

不要求：

- 全量 Evidence Bundle；
- 全量 Requirement Matrix；
- 所有异常排列；
- 连续多次运行；
- 完整性能测试；
- 全部文档更新。

## 4. Hardening Gate

Hardening Gate 根据风险选择：

- failure injection；
- retry/recovery；
- concurrency；
- migration；
- secret scan；
- permission；
- idempotency；
- rollback；
- support bundle；
- repeated stability run。

只有在能力存在后才为其建设 Hardening 测试。

## 5. M0 Functional Acceptance

建议命令：

```bash
make up
make smoke-test
```

若仓库没有 Makefile，可以使用等价命令；不要先为命令形式重构项目。

### M0-F01 Startup

- 服务按 README 启动；
- Web URL 可访问；
- 启动失败有明确错误。

### M0-F02 Workflow View

- 页面显示 Input、Agent、Output 或等价结构；
- 数据来自当前 seed Definition，而非三处重复硬编码。

### M0-F03 Run

- 用户输入 Prompt；
- 创建 Run；
- 状态从 pending/running 到终态；
- Fake Provider 返回确定性结果。

### M0-F04 Result

- 成功显示 Markdown/Text；
- 失败显示结构化错误；
- 页面不无限 loading。

### M0-F05 Configuration

- `.env.example` 无 Secret；
- Fake Provider 默认可用；
- 真实 Provider 仅服务端读取 Key。

### M0-F06 Minimum Verification

至少一个自动化路径覆盖：

```text
create run
→ execute agent
→ produce output
```

M0 不要求单独测试源文件、目录、README 标题或所有 React 组件。

## 6. M0 Hardening Acceptance

在标记 M0 Stable 或对外稳定发布时补充：

- clean startup；
- invalid input；
- provider failure；
- basic redaction；
- service restart 行为说明；
- flaky check。

M0 Stable 仍不要求 M2 Crash Recovery。

## 7. M1 Acceptance

### M1-A Functional

- FlowGram 使用真实 Definition；
- 三节点两边；
- Run 状态 Overlay；
- 节点详情；
- Canvas failure 不阻断 Run。

### M1-A Hardening

- projection contract test；
- dependency lock；
- browser smoke；
- stable node ID；
- visual metadata 不改变业务语义。

### M1-B Functional

- Run/NodeRun 持久化；
- history；
- restart 后可查询。

### M1-C Functional

- ExecutionEvent；
- timeline；
- SSE 或 polling 更新。

## 8. M2 Acceptance

M2 必须使用更强测试：

- kill worker；
- retry creates Attempt；
- duplicate claim；
- cancel；
- timeout；
- waiting/resume；
- idempotency；
- event/state consistency；
- outcome_unknown；
- migration/rollback。

这些测试在 M2 是合理的，因为相应功能已经存在且风险高。

## 9. M3–M5 Acceptance

### M3

- Channel dedup；
- identity；
- Tool policy；
- Approval；
- Evidence；
- Human timeout/resume；
- Golden Workflow evaluation。

### M4

- Authoring round-trip；
- invalid graph diagnostics；
- TestCase；
- Publish Gate；
- version diff/rollback。

### M5

- RBAC；
- audit；
- secret lifecycle；
- memory shadow/A-B；
- sandbox isolation；
- backup/recovery；
- SLO。

## 10. Evidence Policy

普通 Functional Slice 只保存：

- 运行命令；
- 结果摘要；
- 关键截图/日志（需要时）；
- 测试结果；
- 变更文件。

完整 Evidence Bundle 只在以下场景要求：

- 稳定 Release；
- M2 Durable Hardening；
- M3 生产 Tool/Channel；
- M5 Security/Sandbox；
- 用户明确要求。

## 11. Anti-patterns

禁止：

- 先写文件存在性 UT；
- 为 Planned 功能写大规模测试；
- 用 mock-only 测试宣称 E2E 成功；
- 用截图替代关键领域断言；
- 为得到绿色结果删除失败测试；
- 用自动重试掩盖 flaky；
- 测试框架工作量超过当前产品切片；
- 以 Evidence 数量作为完成度；
- 未实现用户路径却标记 Hardening 完成。

## 12. Goal Completion Report

每个 Codex Goal 只需输出：

1. 用户现在可以做什么；
2. 关键文件；
3. 实际运行命令和结果；
4. 新增的必要测试；
5. 尚未解决的最多三个问题；
6. 唯一下一目标。

不要求默认输出全量矩阵。
